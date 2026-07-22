import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  Hospital,
  History,
  Layers3,
  MapPinned,
  Menu,
  Printer,
  RadioTower,
  Route,
  School,
  ShieldAlert,
  SlidersHorizontal,
  Store,
  TrainFront,
  Trees,
  WandSparkles,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { builtInCities, navaNagar, planningRequests, schoolPlanningRequests } from './data/city'
import { hyderabadDraftCandidates, hyderabadDraftDemandZones, hyderabadDraftRiskCorridor, scenarioToMapLayers, type HyderabadScenarioDraft } from './data/hyderabadScenario'
import { scenarios } from './data/scenarios'
import { interpretHospitalRequest, type InterpretationResult } from './lib/requestInterpreter'
import { createPlanningBrief, type PlanningBrief } from './lib/planningBrief'
import { planningTemplates } from './lib/planningTemplates'
import { getCityDataQuality, importGeoJsonPackage, validateCityImport } from './lib/cityImport'
import { analyseHospitalSiteSelection } from './lib/hospitalPlanning'
import { analyseSchoolSiteSelection } from './lib/schoolPlanning'
import { clearRecommendations, loadBackend, removeCity, saveCity, saveRecommendation } from './lib/planningApi'
import type { CityDataset, DatasetLayer, PlanningRequest, PlanningTemplateId, ScenarioId, SchoolPlanningRequest, ScoredCandidate } from './types'
import './index.css'

type MapLayers = {
  density: boolean
  coverage: boolean
  roads: boolean
  riverRisk: boolean
  candidates: boolean
}

type MapSelection =
  | { kind: 'ward'; name: string }
  | { kind: 'hospital'; name: string }
  | { kind: 'candidate'; id: 'A' | 'B' | 'C' }

const SAVED_CITIES_KEY = 'navanagar-imported-cities-v1'
const RECOMMENDATION_HISTORY_KEY = 'navanagar-recommendation-history-v1'
const PLANNING_API_URL = import.meta.env.VITE_PLANNING_API_URL || 'http://localhost:8787'
const sourceLayers: Array<{ key: DatasetLayer; label: string }> = [
  { key: 'wards', label: 'Wards and population' },
  { key: 'roads', label: 'Road network' },
  { key: 'facilities', label: 'Public facilities' },
  { key: 'candidateSites', label: 'Candidate parcels' },
  { key: 'riskZones', label: 'Flood / river-risk zone' },
]

const templateIcons: Record<PlanningTemplateId, typeof Hospital> = { hospital: Hospital, school: School, market: Store, transit: TrainFront, road: Route, 'public-space': Trees, custom: Building2 }

type RecommendationHistoryRecord = {
  id: string
  timestamp: string
  cityId: string
  cityName: string
  scenario: ScenarioId
  templateId?: 'hospital' | 'school'
  request: PlanningRequest | SchoolPlanningRequest
  sourceRequest: string
  winner: { id: string; name: string; score: number }
}

type BackendStatus = 'connecting' | 'synced' | 'offline'

function readSavedCities(): CityDataset[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_CITIES_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.flatMap((item) => {
      const result = validateCityImport(item)
      return result.city ? [result.city] : []
    })
  } catch {
    return []
  }
}

function readRecommendationHistory(): RecommendationHistoryRecord[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECOMMENDATION_HISTORY_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter(isRecommendationHistoryRecord)
  } catch {
    return []
  }
}

function isRecommendationHistoryRecord(item: unknown): item is RecommendationHistoryRecord {
  return Boolean(item && typeof item === 'object' && typeof (item as RecommendationHistoryRecord).id === 'string' && typeof (item as RecommendationHistoryRecord).cityId === 'string' && (item as RecommendationHistoryRecord).request && (item as RecommendationHistoryRecord).winner)
}

function MapView({ city, riverRisk, layers, ranked, winnerId, templateId }: { city: CityDataset; riverRisk: 'normal' | 'expanded'; layers: MapLayers; ranked: ScoredCandidate[]; winnerId?: string; templateId: 'hospital' | 'school' }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const [selection, setSelection] = useState<MapSelection | null>(null)
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)
  const point = ([longitude, latitude]: [number, number]) => ({
    x: 500 + longitude * 4200,
    y: 356 - latitude * 3300,
  })
  const path = (coordinates: [number, number][], close = false) => coordinates
    .map((coordinate, index) => {
      const { x, y } = point(coordinate)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ') + (close ? ' Z' : '')
  const wardFill = (density: number) => density > 85 ? '#c6cb6d' : density > 70 ? '#759861' : '#315d50'
  const mapWidth = 1000 / zoom
  const mapHeight = 720 / zoom
  const viewBox = `${500 - mapWidth / 2 - pan.x} ${360 - mapHeight / 2 - pan.y} ${mapWidth} ${mapHeight}`
  const selectedWard = selection?.kind === 'ward' ? city.wards.find((ward) => ward.name === selection.name) : undefined
  const referenceFacilities = templateId === 'school' ? city.schools ?? [] : city.hospitals
  const selectedFacility = selection?.kind === 'hospital' ? referenceFacilities.find((facility) => facility.name === selection.name) : undefined
  const selectedCandidate = selection?.kind === 'candidate' ? city.candidates.find((candidate) => candidate.id === selection.id) : undefined
  const selectedScore = selectedCandidate ? ranked.find((candidate) => candidate.id === selectedCandidate.id) : undefined
  const clampZoom = (value: number) => Math.min(2.5, Math.max(1, value))
  const adjustZoom = (amount: number) => setZoom((current) => clampZoom(Number((current + amount).toFixed(1))))
  const touchDistance = (touches: { [index: number]: { clientX: number; clientY: number } }) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  const resetMap = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div className={`map-canvas map-illustration ${riverRisk === 'expanded' ? 'monsoon' : ''}`} aria-label={`${city.dataStatus === 'imported' ? 'Imported' : 'Synthetic'} ${city.name} planning map`}>
      <svg viewBox={viewBox} role="img" aria-label={`${city.name} wards, river corridor, ${templateId === 'school' ? 'schools' : 'care centres'}, roads, and candidate parcels`} onPointerDown={(event) => { if (event.pointerType !== 'touch') setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }) }} onPointerMove={(event) => { if (!dragStart) return; const bounds = event.currentTarget.getBoundingClientRect(); setPan({ x: dragStart.panX + ((event.clientX - dragStart.x) / bounds.width) * mapWidth, y: dragStart.panY + ((event.clientY - dragStart.y) / bounds.height) * mapHeight }) }} onPointerUp={() => setDragStart(null)} onPointerLeave={() => setDragStart(null)} onWheel={(event) => { if (!event.ctrlKey) return; event.preventDefault(); setZoom((current) => clampZoom(current * Math.exp(-event.deltaY * .012))) }} onTouchStart={(event) => { if (event.touches.length === 2) pinchStart.current = { distance: touchDistance(event.touches), zoom } }} onTouchMove={(event) => { if (event.touches.length !== 2 || !pinchStart.current) return; event.preventDefault(); setZoom(clampZoom(pinchStart.current.zoom * (touchDistance(event.touches) / pinchStart.current.distance))) }} onTouchEnd={(event) => { if (event.touches.length < 2) pinchStart.current = null }} onClick={() => setSelection(null)}>
        <defs>
          <pattern id="city-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#dce7cc" strokeOpacity=".06" strokeWidth="1" /></pattern>
          <filter id="candidate-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="1000" height="720" fill="#0d1718" />
        <rect width="1000" height="720" fill="url(#city-grid)" />
        <g className="svg-wards">
          {city.wards.map((ward) => {
            return <path key={ward.name} d={path(ward.coordinates, true)} fill={layers.density ? wardFill(ward.density) : '#27433b'} className={selectedWard?.name === ward.name ? 'feature-selected' : ''} onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'ward', name: ward.name }) }}><title>{ward.name}: population {ward.population.toLocaleString()} · density score {ward.density}</title></path>
          })}
        </g>
        {layers.riverRisk && <path className="svg-risk-buffer" d={path(city.river, true)} />}
        <path className="svg-river" d={path(city.river, true)} />
        {layers.roads && <g className="svg-roads">
          {city.roads.map((road, index) => <path key={index} d={path(road)} />)}
        </g>}
        {layers.coverage && <g className="svg-hospitals">
          {referenceFacilities.map((facility) => {
            const { x, y } = point(facility.coordinates)
            return <g key={facility.name} className={selectedFacility?.name === facility.name ? 'feature-selected' : ''} onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'hospital', name: facility.name }) }}><title>{facility.name}: existing {templateId === 'school' ? 'school' : 'emergency-care'} coverage point</title><circle cx={x} cy={y} r="9" /><path d={`M ${x - 3} ${y} H ${x + 3} M ${x} ${y - 3} V ${y + 3}`} /></g>
          })}
        </g>}
        {layers.candidates && <g className="svg-candidates">
          {city.candidates.map((candidate) => {
            const { x, y } = point(candidate.coordinates)
            const scored = ranked.find((item) => item.id === candidate.id)
            return <g key={candidate.id} transform={`translate(${x} ${y})`} className={`${winnerId === candidate.id ? 'candidate-recommended' : ''} ${selectedCandidate?.id === candidate.id ? 'feature-selected' : ''}`} onClick={(event) => { event.stopPropagation(); setSelection({ kind: 'candidate', id: candidate.id }) }}><title>{candidate.name}: {scored?.excluded ? scored.exclusionReasons.join(' ') : `${scored?.score}/100 suitability`}</title><circle r="18" className={`candidate-${candidate.id.toLowerCase()}`} filter="url(#candidate-glow)" /><text dy="4">{candidate.id}</text></g>
          })}
        </g>}
        <g className="svg-map-detail">
          <path d="M 904 64 l 0 34 M 896 73 l 8 -9 8 9" /><text x="900" y="119">N</text>
          <path d="M 70 656 h 92" /><text x="70" y="675">2 KM</text>
        </g>
      </svg>
      <div className="map-controls" aria-label="Map zoom controls"><button onClick={() => adjustZoom(.2)} title="Zoom in"><ZoomIn size={14} /></button><button onClick={() => adjustZoom(-.2)} title="Zoom out"><ZoomOut size={14} /></button><button onClick={resetMap} title="Reset map">1:1</button></div>
      {selection && <aside className="map-inspector">
        <button onClick={() => setSelection(null)} aria-label="Close map inspection">×</button>
        {selectedWard && <><span>WARD INSPECTION</span><h3>{selectedWard.name}</h3><dl><dt>Population</dt><dd>{selectedWard.population.toLocaleString()}</dd><dt>Density</dt><dd>{selectedWard.density}/100</dd><dt>{templateId === 'school' ? 'School-age demand' : 'Emergency demand'}</dt><dd>{templateId === 'school' ? selectedWard.schoolAgeDemand ?? 'Not supplied' : selectedWard.emergencyDemand}{templateId === 'school' && selectedWard.schoolAgeDemand !== undefined ? '/100' : ''}</dd><dt>{templateId === 'school' ? 'School coverage' : 'Care coverage'}</dt><dd>{templateId === 'school' ? selectedWard.existingSchoolCoverage ?? 'Not supplied' : selectedWard.existingHospitalCoverage}{templateId === 'school' && selectedWard.existingSchoolCoverage !== undefined ? '/100' : ''}</dd></dl></>}
        {selectedFacility && <><span>EXISTING REFERENCE FACILITY</span><h3>{selectedFacility.name}</h3><p>One of {referenceFacilities.length} {city.dataStatus === 'imported' ? 'imported' : 'synthetic'} {templateId === 'school' ? 'school' : 'care'} coverage reference points.</p></>}
        {selectedCandidate && <><span>CANDIDATE PARCEL {selectedCandidate.id}</span><h3>{selectedCandidate.name}</h3><p>{selectedCandidate.location}</p><dl><dt>Suitability</dt><dd>{selectedScore?.excluded ? 'Excluded' : `${selectedScore?.score}/100`}</dd><dt>Land</dt><dd>{selectedCandidate.siteAreaAcres} acres · {selectedCandidate.ownership}</dd><dt>Road access</dt><dd>{selectedCandidate.roadAccessScore}/100</dd><dt>Flood risk</dt><dd>{selectedCandidate.floodRisk}</dd></dl>{selectedScore?.excluded && <small className="inspector-warning">{selectedScore.exclusionReasons.join(' ')}</small>}</>}
      </aside>}
    </div>
  )
}

void MapView

function HyderabadBaseMap() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [scenarioVisible, setScenarioVisible] = useState(true)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('Plan an emergency hospital to improve access for growing areas of Hyderabad.')
  const [generatorState, setGeneratorState] = useState<'idle' | 'generating' | 'error'>('idle')
  const [generatorMessage, setGeneratorMessage] = useState('')
  const [draftSummary, setDraftSummary] = useState('Baseline AI-assisted draft scenario. All zones and points are illustrative.')

  useEffect(() => {
    if (!container.current || map.current) return
    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
      container: container.current,
      center: [78.4867, 17.385],
      zoom: 11.2,
      minZoom: 9,
      maxZoom: 18,
      style: {
        version: 8,
        sources: {
          openstreetmap: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
          },
        },
        layers: [{ id: 'openstreetmap-base', type: 'raster', source: 'openstreetmap', paint: { 'raster-saturation': -0.72, 'raster-contrast': .18, 'raster-brightness-min': .06, 'raster-brightness-max': .58 } }],
      },
      })
    } catch {
      setStatus('unavailable')
      return
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    instance.once('load', () => {
      instance.addSource('ai-draft-demand-zones', { type: 'geojson', data: hyderabadDraftDemandZones })
      instance.addLayer({ id: 'ai-draft-demand-fill', type: 'fill', source: 'ai-draft-demand-zones', paint: { 'fill-color': ['match', ['get', 'priority'], 'high', '#d8e674', '#8ab7de'], 'fill-opacity': .38 } })
      instance.addLayer({ id: 'ai-draft-demand-outline', type: 'line', source: 'ai-draft-demand-zones', paint: { 'line-color': ['match', ['get', 'priority'], 'high', '#eff6a6', '#b7daf0'], 'line-width': 2.5, 'line-opacity': 1 } })
      instance.addSource('ai-draft-candidates', { type: 'geojson', data: hyderabadDraftCandidates })
      instance.addLayer({ id: 'ai-draft-candidate-halo', type: 'circle', source: 'ai-draft-candidates', paint: { 'circle-radius': 18, 'circle-color': '#d8e674', 'circle-opacity': .26, 'circle-stroke-color': '#f4fac2', 'circle-stroke-width': 1.5 } })
      instance.addLayer({ id: 'ai-draft-candidate-point', type: 'circle', source: 'ai-draft-candidates', paint: { 'circle-radius': 9, 'circle-color': ['match', ['get', 'id'], 'A', '#d8e674', 'B', '#e5b96b', '#9bc8e4'], 'circle-stroke-color': '#101918', 'circle-stroke-width': 4 } })
      instance.addSource('ai-draft-risk-corridor', { type: 'geojson', data: hyderabadDraftRiskCorridor })
      instance.addLayer({ id: 'ai-draft-risk-line', type: 'line', source: 'ai-draft-risk-corridor', paint: { 'line-color': '#ff9a81', 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 1 } })
    })
    instance.once('idle', () => {
      instance.resize()
      setStatus('ready')
    })
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !map.current) return
    const visibility = scenarioVisible ? 'visible' : 'none'
    ;['ai-draft-demand-fill', 'ai-draft-demand-outline', 'ai-draft-candidate-halo', 'ai-draft-candidate-point', 'ai-draft-risk-line'].forEach((id) => {
      if (map.current?.getLayer(id)) map.current.setLayoutProperty(id, 'visibility', visibility)
    })
  }, [scenarioVisible, status])

  const recenterMap = () => map.current?.easeTo({ center: [78.4867, 17.385], zoom: 11.2, bearing: 0, pitch: 0, duration: 750, essential: true })
  const applyDraft = (draft: HyderabadScenarioDraft) => {
    if (!map.current) return
    const layers = scenarioToMapLayers(draft)
    ;(map.current.getSource('ai-draft-demand-zones') as maplibregl.GeoJSONSource | undefined)?.setData(layers.demandZones)
    ;(map.current.getSource('ai-draft-candidates') as maplibregl.GeoJSONSource | undefined)?.setData(layers.candidates)
    ;(map.current.getSource('ai-draft-risk-corridor') as maplibregl.GeoJSONSource | undefined)?.setData(layers.riskCorridor)
    setScenarioVisible(true)
    setDraftSummary(draft.summary)
  }
  const generateScenario = async () => {
    if (draftPrompt.trim().length < 8) return
    setGeneratorState('generating')
    setGeneratorMessage('')
    try {
      const response = await fetch(`${PLANNING_API_URL}/api/ai/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: draftPrompt.trim() }) })
      const payload = await response.json() as { draft?: HyderabadScenarioDraft; error?: string; provenance?: string }
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? 'The AI scenario could not be generated.')
      applyDraft(payload.draft)
      setGeneratorMessage(payload.provenance ?? 'New AI-assisted draft applied to the map.')
      setGeneratorState('idle')
    } catch (error) {
      setGeneratorMessage(error instanceof Error ? error.message : 'The AI scenario could not be generated.')
      setGeneratorState('error')
    }
  }

  return <div className="map-canvas real-city-map" aria-label="Interactive Hyderabad base map from OpenStreetMap">
    <div ref={container} className="maplibre-target" />
    <button className="map-reset-button" onClick={recenterMap} disabled={status !== 'ready'} title="Return to the Hyderabad city view"><MapPinned size={13} /> Auto-adjust map</button>
    <button className={`ai-layer-button ${scenarioVisible ? 'is-on' : ''}`} onClick={() => setScenarioVisible((visible) => !visible)} disabled={status !== 'ready'} title="Show or hide AI-assisted scenario estimates"><WandSparkles size={13} /> AI draft: {scenarioVisible ? 'on' : 'off'}</button>
    <button className="ai-generate-button" onClick={() => setGeneratorOpen((open) => !open)} disabled={status !== 'ready'} title="Generate a new AI-assisted map scenario"><WandSparkles size={13} /> Draft with AI</button>
    {generatorOpen && <section className="ai-generator-panel"><span>LIVE AI SCENARIO DRAFT</span><p>Describe the planning need. The AI returns a hypothetical map layer inside Hyderabad only.</p><textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} maxLength={800} placeholder="Example: Plan a school for a growing eastern residential area." /><button onClick={generateScenario} disabled={generatorState === 'generating' || draftPrompt.trim().length < 8}>{generatorState === 'generating' ? 'Drafting map scenario…' : 'Generate draft layer'}</button>{generatorMessage && <small className={generatorState === 'error' ? 'ai-generator-error' : ''}>{generatorMessage}</small>}<em>{draftSummary}</em></section>}
    {status === 'loading' && <div className="map-load-state">LOADING HYDERABAD BASE MAP…</div>}
    {status === 'unavailable' && <div className="map-load-state map-load-error"><strong>Interactive map unavailable in this browser.</strong><span>OpenStreetMap needs WebGL here. Try Chrome or a hardware-accelerated browser.</span><a href="https://www.openstreetmap.org/#map=11/17.3850/78.4867" target="_blank" rel="noreferrer">Open Hyderabad in OpenStreetMap</a></div>}
  </div>
}

function clonePlanningRequest(request: PlanningRequest): PlanningRequest {
  return {
    ...request,
    facilityProfile: { ...request.facilityProfile },
    conditions: { ...request.conditions },
    weights: { ...request.weights },
  }
}

function cloneSchoolPlanningRequest(request: SchoolPlanningRequest): SchoolPlanningRequest {
  return { ...request, facilityProfile: { ...request.facilityProfile }, conditions: { ...request.conditions }, weights: { ...request.weights } }
}

function App() {
  const [scenario, setScenario] = useState<ScenarioId>('baseline')
  const [city, setCity] = useState<CityDataset>(navaNagar)
  const [savedCities, setSavedCities] = useState<CityDataset[]>(readSavedCities)
  const [recommendationHistory, setRecommendationHistory] = useState<RecommendationHistoryRecord[]>(readRecommendationHistory)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('connecting')
  const [backendLoaded, setBackendLoaded] = useState(false)
  const [activeRequest, setActiveRequest] = useState<PlanningRequest>(() => clonePlanningRequest(planningRequests.baseline))
  const [activeSchoolRequest, setActiveSchoolRequest] = useState<SchoolPlanningRequest>(() => cloneSchoolPlanningRequest(schoolPlanningRequests.baseline))
  const [activeTemplateId, setActiveTemplateId] = useState<'hospital' | 'school'>('hospital')
  const [hasRun, setHasRun] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestText, setRequestText] = useState('')
  const [interpretation, setInterpretation] = useState<InterpretationResult | null>(null)
  const [planningBrief, setPlanningBrief] = useState<PlanningBrief | null>(null)
  const [activePlanningBrief, setActivePlanningBrief] = useState<PlanningBrief | null>(null)
  const [sourceRequest, setSourceRequest] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [lastImportedCityId, setLastImportedCityId] = useState<string | null>(null)
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [templateCatalogOpen, setTemplateCatalogOpen] = useState(false)
  const [templateNotice, setTemplateNotice] = useState('Hospital site selection is the active recommendation engine.')
  const [sourceDraft, setSourceDraft] = useState<CityDataset['provenance']>({})
  const importInput = useRef<HTMLInputElement>(null)
  const packageInput = useRef<HTMLInputElement>(null)
  const availableCities = [...builtInCities, ...savedCities]
  const qualityReviewCity = city.dataStatus === 'imported' ? city : savedCities.find((item) => item.id === lastImportedCityId)
  const qualityReview = qualityReviewCity ? getCityDataQuality(qualityReviewCity) : null

  useEffect(() => {
    localStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(savedCities))
  }, [savedCities])

  useEffect(() => {
    localStorage.setItem(RECOMMENDATION_HISTORY_KEY, JSON.stringify(recommendationHistory))
  }, [recommendationHistory])

  useEffect(() => {
    let cancelled = false
    void loadBackend<CityDataset, RecommendationHistoryRecord>().then((remote) => {
      if (cancelled) return
      const remoteCities = remote.cities.flatMap((item) => {
        const result = validateCityImport(item)
        return result.city ? [result.city] : []
      })
      const remoteHistory = remote.recommendations.filter(isRecommendationHistoryRecord)
      setSavedCities((current) => {
        const combined = new Map(remoteCities.map((item) => [item.id, item]))
        current.forEach((item) => combined.set(item.id, item))
        return [...combined.values()]
      })
      setRecommendationHistory((current) => {
        const combined = new Map(remoteHistory.map((item) => [item.id, item]))
        current.forEach((item) => combined.set(item.id, item))
        return [...combined.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 20)
      })
      setBackendStatus('synced')
      setBackendLoaded(true)
    }).catch(() => {
      if (cancelled) return
      setBackendStatus('offline')
      setBackendLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!backendLoaded || backendStatus !== 'synced') return
    void Promise.all(savedCities.map((item) => saveCity(item))).catch(() => setBackendStatus('offline'))
  }, [backendLoaded, backendStatus, savedCities])

  useEffect(() => {
    if (!backendLoaded || backendStatus !== 'synced') return
    void Promise.all(recommendationHistory.map((item) => saveRecommendation(item))).catch(() => setBackendStatus('offline'))
  }, [backendLoaded, backendStatus, recommendationHistory])

  const hospitalAnalysis = useMemo(() => analyseHospitalSiteSelection(city, activeRequest), [city, activeRequest])
  const schoolAnalysis = useMemo(() => analyseSchoolSiteSelection(city, activeSchoolRequest), [city, activeSchoolRequest])
  const activeAnalysis = activeTemplateId === 'school' ? schoolAnalysis : hospitalAnalysis
  const ranked = activeAnalysis.rankedCandidates
  const winner = activeAnalysis.winner
  const activeIsSchool = activeTemplateId === 'school'
  const activeConditions = activeIsSchool ? activeSchoolRequest.conditions : activeRequest.conditions
  const activeWeights = activeIsSchool ? activeSchoolRequest.weights : activeRequest.weights
  const activeCapacity = activeIsSchool ? activeSchoolRequest.facilityProfile.classrooms : activeRequest.facilityProfile.beds
  const activeCapacityUnit = activeIsSchool ? 'classrooms' : 'beds'
  const activeMinimumLand = activeIsSchool ? activeSchoolRequest.facilityProfile.minimumLandArea : activeRequest.facilityProfile.minimumLandArea
  const activeBudget = activeIsSchool ? activeSchoolRequest.facilityProfile.budgetLakhs : activeRequest.facilityProfile.budgetLakhs
  const activeLandPreference = activeIsSchool ? activeSchoolRequest.facilityProfile.landPreference : activeRequest.facilityProfile.landPreference
  const activeTimeTarget = activeIsSchool ? activeSchoolRequest.facilityProfile.targetWalkTime : activeRequest.facilityProfile.targetResponseTime
  const cityDataQuality = getCityDataQuality(city)
  const scenarioData = scenarios.find((item) => item.id === scenario)!
  const hasCustomAssumptions = activeIsSchool ? JSON.stringify(activeSchoolRequest) !== JSON.stringify(schoolPlanningRequests[scenario]) : JSON.stringify(activeRequest) !== JSON.stringify(planningRequests[scenario])
  const scenarioLabel = hasCustomAssumptions ? `${scenarioData.label} · adjusted assumptions` : scenarioData.label
  const responseGap = winner ? Number.parseFloat(winner.response) - activeTimeTarget : 0
  const reportProvenance = sourceLayers.map((layer) => {
    const entry = city.provenance?.[layer.key]
    const declared = entry?.status === 'declared' && Boolean(entry.source.trim())
    return { ...layer, entry, declared, reliability: declared ? entry?.reliability ?? 'estimated' : 'missing' }
  })
  const siteBenefits = winner ? [
    activeIsSchool ? `Safe-access score is ${winner.travel}/100, supporting reliable walking and school access.` : `Road access is ${winner.roadAccessScore}/100, supporting reliable ambulance movement.`,
    `The site can reach ${winner.served} with an estimated ${winner.response} ${activeIsSchool ? 'walking time' : 'response time'}.`,
    `${winner.siteAreaAcres} acres satisfies the current land requirement for a ${activeCapacity}-${activeCapacityUnit} ${activeIsSchool ? 'school' : 'hospital'}.`,
    winner.ownership === 'municipal' ? 'Municipal ownership avoids a private-land acquisition process.' : 'The parcel remains eligible because acquisition is allowed for this brief.',
  ] : []
  const siteConcerns = winner ? [
    winner.floodRisk === 'high' ? 'High river exposure needs mitigation and can make the site ineligible in monsoon conditions.' : winner.floodRisk === 'medium' ? 'Medium flood exposure requires a drainage and monsoon-access survey.' : 'Low flood exposure still needs confirmation against the official hazard layer.',
    winner.ownership === 'private' ? `Land acquisition is required; the estimated ₹${winner.acquisitionCostLakhs} lakh cost is included as a suitability penalty.` : 'Confirm land title, zoning, and utility access before procurement.',
    activeIsSchool ? 'Student-demand, school-coverage, cost, and walking-time inputs are synthetic and require official validation.' : 'Population, cost, and response-time inputs are synthetic and require official validation.',
  ] : []
  const updateRequest = (updater: (current: PlanningRequest) => PlanningRequest) => {
    setActiveRequest((current) => updater(current))
    setActivePlanningBrief(null)
    setHasRun(false)
    setShowReport(false)
  }
  const updateSchoolRequest = (updater: (current: SchoolPlanningRequest) => SchoolPlanningRequest) => {
    setActiveSchoolRequest((current) => updater(current))
    setActivePlanningBrief(null)
    setHasRun(false)
    setShowReport(false)
  }
  const chooseScenario = (nextScenario: ScenarioId) => {
    setScenario(nextScenario)
    setActiveRequest(clonePlanningRequest(planningRequests[nextScenario]))
    setActiveSchoolRequest(cloneSchoolPlanningRequest(schoolPlanningRequests[nextScenario]))
    setHasRun(false)
    setShowReport(false)
    setSourceRequest('')
    setActivePlanningBrief(null)
  }
  const chooseCity = (cityId: string) => {
    if (cityId === 'add-city') {
      setImportOpen(true)
      return
    }
    const nextCity = availableCities.find((item) => item.id === cityId)
    if (!nextCity) return
    setCity(nextCity)
    setHasRun(false)
    setShowReport(false)
    setSourceRequest('')
    setActivePlanningBrief(null)
  }
  const selectPlanningTemplate = (templateId: PlanningTemplateId) => {
    const template = planningTemplates.find((item) => item.id === templateId)
    if (!template) return
    if (template.availability === 'active' && (templateId === 'hospital' || templateId === 'school')) {
      setActiveTemplateId(templateId)
      setActivePlanningBrief(null)
      setHasRun(false)
      setShowReport(false)
      setTemplateNotice(`${template.label} site selection is active. Review its assumptions before analysing parcels.`)
      return
    }
    setTemplateNotice(`${template.label} is available for structured planning briefs only; its specialist location engine has not been enabled yet.`)
  }
  const importCity = async (file?: File) => {
    if (!file) return
    try {
      const result = validateCityImport(JSON.parse(await file.text()))
      if (!result.city) { setImportMessage(result.errors.join(' ')); return }
      setSavedCities((current) => [...current.filter((item) => item.id !== result.city!.id), result.city!])
      setLastImportedCityId(result.city.id)
      setSourceEditorOpen(false)
      setImportMessage(`Imported ${result.city.name}. It has been saved for future use.`)
    } catch {
      setImportMessage('Unable to read this JSON file. Check its format and try again.')
    }
  }
  const importPackage = async (files: FileList | null) => {
    if (!files?.length) return
    const result = await importGeoJsonPackage([...files])
    if (!result.city) { setImportMessage(result.errors.join(' ')); return }
    setSavedCities((current) => [...current.filter((item) => item.id !== result.city!.id), result.city!])
    setLastImportedCityId(result.city.id)
    setSourceEditorOpen(false)
    setImportMessage(`Imported ${result.city.name} from a six-file GeoJSON package. It has been saved for future use.`)
  }
  const downloadCityTemplate = () => {
    const template = {
      ...navaNagar,
      id: 'my-city',
      name: 'My City',
      dataStatus: 'imported' as const,
      provenance: {
        wards: { source: '', status: 'not-provided' as const, reliability: 'missing' as const },
        roads: { source: '', status: 'not-provided' as const, reliability: 'missing' as const },
        facilities: { source: '', status: 'not-provided' as const, reliability: 'missing' as const },
        candidateSites: { source: '', status: 'not-provided' as const, reliability: 'missing' as const },
        riskZones: { source: '', status: 'not-provided' as const, reliability: 'missing' as const },
      },
    }
    const file = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = 'city-template.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const downloadGeoJsonStarterBundle = () => {
    const featureCollection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
    const files = [
      ['city.json', { id: 'starter-city', name: 'Starter City', scale: navaNagar.scale, provenance: { wards: { source: '', status: 'not-provided', reliability: 'missing' }, roads: { source: '', status: 'not-provided', reliability: 'missing' }, facilities: { source: '', status: 'not-provided', reliability: 'missing' }, candidateSites: { source: '', status: 'not-provided', reliability: 'missing' }, riskZones: { source: '', status: 'not-provided', reliability: 'missing' } } }],
      ['wards.geojson', featureCollection(navaNagar.wards.map((ward) => ({ type: 'Feature', properties: { name: ward.name, density: ward.density, population: ward.population, populationGrowth: ward.populationGrowth, emergencyDemand: ward.emergencyDemand, existingHospitalCoverage: ward.existingHospitalCoverage, schoolAgeDemand: ward.schoolAgeDemand, existingSchoolCoverage: ward.existingSchoolCoverage }, geometry: { type: 'Polygon', coordinates: [ward.coordinates] } })))],
      ['roads.geojson', featureCollection(navaNagar.roads.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })))],
      ['facilities.geojson', featureCollection([...navaNagar.hospitals.map((hospital) => ({ type: 'Feature', properties: { name: hospital.name, kind: 'hospital' }, geometry: { type: 'Point', coordinates: hospital.coordinates } })), ...(navaNagar.schools ?? []).map((school) => ({ type: 'Feature', properties: { name: school.name, kind: 'school' }, geometry: { type: 'Point', coordinates: school.coordinates } }))])],
      ['candidate_sites.geojson', featureCollection(navaNagar.candidates.map(({ coordinates, ...properties }) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } })))],
      ['risk_zones.geojson', featureCollection([{ type: 'Feature', properties: { name: 'River risk zone' }, geometry: { type: 'Polygon', coordinates: [navaNagar.river] } }])],
    ] as const
    files.forEach(([name, content], index) => window.setTimeout(() => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }))
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }, index * 180))
    setImportMessage('Downloading six starter files. Keep them together in one folder, then select all six for the GeoJSON import.')
  }
  const deleteCity = (cityId: string) => {
    if (city.id === cityId) setCity(navaNagar)
    setSavedCities((current) => current.filter((item) => item.id !== cityId))
    if (lastImportedCityId === cityId) setLastImportedCityId(null)
    if (backendStatus === 'synced') void removeCity(cityId).catch(() => setBackendStatus('offline'))
  }
  const beginSourceEdit = () => {
    if (!qualityReviewCity) return
    setSourceDraft(sourceLayers.reduce<NonNullable<CityDataset['provenance']>>((draft, layer) => ({
      ...draft,
      [layer.key]: qualityReviewCity.provenance?.[layer.key] ?? { source: '', asOf: '', status: 'not-provided', reliability: 'missing' },
    }), {}))
    setSourceEditorOpen(true)
  }
  const saveSourceRegister = () => {
    if (!qualityReviewCity) return
    const provenance = sourceLayers.reduce<NonNullable<CityDataset['provenance']>>((draft, layer) => {
      const entry = sourceDraft?.[layer.key]
      const source = entry?.source.trim() ?? ''
      return { ...draft, [layer.key]: { source, asOf: entry?.asOf?.trim() || undefined, status: source ? 'declared' : 'not-provided', reliability: source ? entry?.reliability ?? 'estimated' : 'missing' } }
    }, {})
    const updated = { ...qualityReviewCity, provenance }
    setSavedCities((current) => current.map((item) => item.id === updated.id ? updated : item))
    if (city.id === updated.id) setCity(updated)
    setImportMessage(`Saved source declarations for ${updated.name}. They are self-reported and still need municipal verification.`)
    setSourceEditorOpen(false)
  }
  const downloadFieldMappingTemplate = () => {
    const rows = [
      ['app_layer', 'app_field', 'expected municipal column / attribute', 'type', 'required', 'example'],
      ['wards', 'name', 'ward_name / ward_no', 'text', 'yes', 'Ward 01'],
      ['wards', 'population', 'total_population', 'number', 'yes', '14200'],
      ['wards', 'density', 'population_density_index', 'number (0-100)', 'yes', '88'],
      ['wards', 'populationGrowth', 'projected_growth_percent', 'number', 'yes', '12'],
      ['wards', 'emergencyDemand', 'emergency_demand_index', 'number (0-100)', 'yes', '81'],
      ['wards', 'existingHospitalCoverage', 'care_coverage_index', 'number (0-100)', 'yes', '43'],
      ['wards', 'schoolAgeDemand', 'school_age_demand_index', 'number (0-100)', 'for School', '79'],
      ['wards', 'existingSchoolCoverage', 'school_coverage_index', 'number (0-100)', 'for School', '38'],
      ['candidate_sites', 'id', 'site_id', 'A / B / C', 'yes', 'A'],
      ['candidate_sites', 'siteAreaAcres', 'site_area_acres', 'number', 'yes', '5.4'],
      ['candidate_sites', 'ownership', 'ownership_type', 'municipal / private', 'yes', 'municipal'],
      ['candidate_sites', 'roadAccessScore', 'road_access_index', 'number (0-100)', 'yes', '92'],
      ['candidate_sites', 'floodRisk', 'flood_risk_class', 'low / medium / high', 'yes', 'medium'],
      ['candidate_sites', 'school.access', 'school_safe_access_index', 'number (0-100)', 'for School', '90'],
      ['candidate_sites', 'school.need', 'school_unmet_need_index', 'number (0-100)', 'for School', '88'],
      ['candidate_sites', 'school.growth', 'school_growth_index', 'number (0-100)', 'for School', '94'],
      ['candidate_sites', 'school.served', 'school_age_children_served', 'number', 'for School', '6800'],
      ['candidate_sites', 'school.walkTime', 'school_walk_time_minutes', 'number', 'for School', '9.2'],
      ['candidate_sites', 'school.tradeoff', 'school_tradeoff_note', 'text', 'for School', 'Acquisition required'],
      ['facilities', 'name', 'facility_name', 'text', 'yes', 'District Hospital'],
      ['facilities', 'kind', 'facility_kind', 'hospital / school', 'yes', 'school'],
      ['roads', 'geometry', 'road centreline', 'GeoJSON LineString', 'yes', '—'],
      ['risk_zones', 'geometry', 'river / flood-risk area', 'GeoJSON Polygon', 'yes', '—'],
    ]
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = 'navanagar-municipal-field-mapping.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  const openReport = () => {
    if (hasRun && winner) setShowReport(true)
  }
  const runRecommendation = () => {
    if (!winner || activePlanningBrief) return
    setHasRun(true)
    const record: RecommendationHistoryRecord = {
      id: `${Date.now()}-${winner.id}`,
      timestamp: new Date().toISOString(),
      cityId: city.id,
      cityName: city.name,
      scenario,
      templateId: activeTemplateId,
      request: activeIsSchool ? cloneSchoolPlanningRequest(activeSchoolRequest) : clonePlanningRequest(activeRequest),
      sourceRequest,
      winner: { id: winner.id, name: winner.name, score: winner.score! },
    }
    setRecommendationHistory((current) => [record, ...current].slice(0, 20))
  }
  const clearRecommendationHistory = () => {
    setRecommendationHistory([])
    if (backendStatus === 'synced') void clearRecommendations().catch(() => setBackendStatus('offline'))
  }
  const reopenRecommendation = (record: RecommendationHistoryRecord) => {
    const savedCity = availableCities.find((item) => item.id === record.cityId)
    if (!savedCity) return
    setCity(savedCity)
    setScenario(record.scenario)
    if (record.templateId === 'school' || record.request.facilityType === 'school') {
      setActiveTemplateId('school')
      setActiveSchoolRequest(cloneSchoolPlanningRequest(record.request as SchoolPlanningRequest))
    } else {
      setActiveTemplateId('hospital')
      setActiveRequest(clonePlanningRequest(record.request as PlanningRequest))
    }
    setSourceRequest(record.sourceRequest)
    setHasRun(true)
    setShowReport(false)
    setHistoryOpen(false)
  }
  const interpretRequest = () => {
    if (!requestText.trim()) return
    if (/\b(hospital|emergency hospital|emergency care)\b/i.test(requestText)) {
      setActiveTemplateId('hospital')
      setInterpretation(interpretHospitalRequest(requestText, activeRequest))
      setPlanningBrief(null)
      return
    }
    if (/\b(school|classroom|education|college)\b/i.test(requestText)) {
      setActiveTemplateId('school')
      setActivePlanningBrief(null)
      setPlanningBrief(null)
      setInterpretation(null)
      setSourceRequest(requestText.trim())
      setBriefOpen(true)
      setHasRun(false)
      setShowReport(false)
      setTemplateNotice('School site selection is active. Review the classroom, land, walking-time, and budget assumptions before analysing parcels.')
      return
    }
    setInterpretation(null)
    setPlanningBrief(createPlanningBrief(requestText))
  }
  const applyInterpretation = () => {
    if (!interpretation) return
    setActiveRequest(interpretation.request)
    setActiveTemplateId('hospital')
    setSourceRequest(requestText.trim())
    setActivePlanningBrief(null)
    setBriefOpen(true)
    setHasRun(false)
    setShowReport(false)
  }
  const applyPlanningBrief = () => {
    if (!planningBrief) return
    setActivePlanningBrief(planningBrief)
    setSourceRequest(requestText.trim())
    setHasRun(false)
    setShowReport(false)
    setTemplateNotice(`${planningBrief.title} is saved as a ${planningBrief.mode}. ${planningBrief.nextStep}`)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setShowReport(false)} aria-label="Return to planning studio">
          <span className="brand-mark"><MapPinned size={18} /></span>
          <span>{city.name.toUpperCase()}</span>
          <em>PLANNING STUDIO</em>
        </button>
        <div className="topbar-meta"><span className="live-dot" /> <span className="city-selector-label">PLANNING DATA:</span><select className="city-selector" value={city.id} onChange={(event) => chooseCity(event.target.value)} aria-label="Change planning dataset">{availableCities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.dataStatus}</option>)}<option value="add-city">＋ Add your city — import JSON</option></select><span className={`backend-status ${backendStatus}`}>{backendStatus === 'synced' ? 'LOCAL API SYNCED' : backendStatus === 'offline' ? 'BROWSER MODE' : 'CONNECTING API'}</span></div>
        <button className="history-link" onClick={() => setHistoryOpen(true)}><History size={15} /> Decision history {recommendationHistory.length > 0 && <b>{recommendationHistory.length}</b>}</button>
        <button className="report-link" onClick={openReport} disabled={!hasRun || !winner} title={hasRun && winner ? 'Open planning report' : 'Run a viable recommendation first'}><FileText size={15} /> Planning report <ChevronRight size={15} /></button>
      </header>
      {historyOpen && <section className="history-dialog" role="dialog" aria-modal="true" aria-label="Saved recommendation history"><div className="history-card"><button className="import-close" onClick={() => setHistoryOpen(false)} aria-label="Close recommendation history">×</button><span>{backendStatus === 'synced' ? 'SAVED DECISION HISTORY' : 'LOCAL DECISION HISTORY'}</span><h2>Past recommendations</h2><p>{backendStatus === 'synced' ? 'Stored in this browser and synchronised with the local planning API. Reopening a decision restores its city and planning assumptions; current city data must still be available.' : 'Stored only in this browser while the local planning API is unavailable. Reopening a decision restores its city and planning assumptions; current city data must still be available.'}</p>{recommendationHistory.length === 0 ? <div className="history-empty"><History size={20} /><strong>No saved recommendations yet</strong><small>Run a viable recommendation to create the first audit record.</small></div> : <><div className="history-list">{recommendationHistory.map((record) => { const available = availableCities.some((item) => item.id === record.cityId); return <div key={record.id}><div><span>{record.cityName} · {record.scenario}</span><strong>{record.winner.name} <em>{record.winner.score}/100</em></strong><small>{new Date(record.timestamp).toLocaleString()}</small></div><button disabled={!available} onClick={() => reopenRecommendation(record)}>{available ? 'Reopen' : 'City removed'}</button></div>})}</div><button className="clear-history-button" onClick={clearRecommendationHistory}>Clear saved history</button></>}</div></section>}
      {importOpen && <section className="import-dialog" role="dialog" aria-modal="true" aria-label="Import city dataset">
        <div className="import-card">
          <button className="import-close" onClick={() => setImportOpen(false)} aria-label="Close import panel">×</button>
          <span>CITY DATA PACKAGE</span>
          <h2>Add your city</h2>
          <p><b>Recommended:</b> upload the six-file municipal bundle below. The quick city.json route remains available for a prepared demo dataset.</p>
          <code>city.json + wards.geojson + roads.geojson + facilities.geojson + candidate_sites.geojson + risk_zones.geojson</code>
          <input ref={packageInput} type="file" accept="application/json,.json,application/geo+json,.geojson" multiple hidden onChange={(event) => importPackage(event.target.files)} />
          <button className="import-package-button" onClick={() => packageInput.current?.click()}>Choose GeoJSON city package</button>
          <p className="package-fields">Hospital fields: <b>emergencyDemand, existingHospitalCoverage</b>. To run School planning too, include <b>schoolAgeDemand, existingSchoolCoverage</b> in wards, <b>kind: school</b> in facilities, and the nested <b>school</b> metrics on each candidate parcel. Candidate parcels use Point or Polygon geometry.</p>
          <button className="starter-package-button" onClick={downloadGeoJsonStarterBundle}>Download six-file GeoJSON starter</button>
          <button className="mapping-template-button" onClick={downloadFieldMappingTemplate}>Download municipal field-mapping worksheet</button>
          <div className="import-divider"><span>OR QUICK DEMO IMPORT</span></div>
          <button className="template-button" onClick={downloadCityTemplate}>Download valid city template</button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => importCity(event.target.files?.[0])} />
          <button className="import-file-button" onClick={() => importInput.current?.click()}>Choose city.json</button>
          {importMessage && <p className="import-message">{importMessage}</p>}
          {lastImportedCityId && <button className="open-city-button" onClick={() => { chooseCity(lastImportedCityId); setImportOpen(false) }}>Open imported city</button>}
          {qualityReview && <section className="quality-review" aria-label="Imported city data quality review">
            <div className="quality-heading"><span>DATA QUALITY REVIEW</span><b>{qualityReview.structuralCount}/5 structure-ready</b></div>
            <p><strong>{qualityReviewCity?.name}</strong> can be explored in this prototype. Source declarations are a separate municipal-verification step.</p>
            <div className="quality-summary"><span>{qualityReview.provenanceCount}/5</span><small>layers have a declared source</small></div>
            <div className="quality-layers">{qualityReview.layers.map((layer) => <div key={layer.key}><span className={layer.structuralReady ? 'quality-pass' : 'quality-watch'}>{layer.structuralReady ? '✓' : '!'}</span><strong>{layer.label}</strong><small>{layer.provenanceDeclared ? `${layer.reliability === 'verified' ? 'Marked verified' : 'Estimated'} source — audit before official use` : 'Missing source — municipal verification needed'}</small></div>)}</div>
            <button className="source-register-button" onClick={beginSourceEdit}>Declare data sources</button>
            {sourceEditorOpen && <div className="source-register"><span>SOURCE REGISTER</span><p>Record the issuing department, portal, or document for each layer, then mark its reliability. A self-marked “verified” label should still be independently checked before an official decision.</p>{sourceLayers.map((layer) => <label key={layer.key}><b>{layer.label}</b><input value={sourceDraft?.[layer.key]?.source ?? ''} onChange={(event) => setSourceDraft((current) => ({ ...current, [layer.key]: { source: event.target.value, asOf: current?.[layer.key]?.asOf, status: event.target.value.trim() ? 'declared' : 'not-provided', reliability: current?.[layer.key]?.reliability ?? 'estimated' } }))} placeholder="Department, portal, or document" /><input value={sourceDraft?.[layer.key]?.asOf ?? ''} onChange={(event) => setSourceDraft((current) => ({ ...current, [layer.key]: { source: current?.[layer.key]?.source ?? '', asOf: event.target.value, status: current?.[layer.key]?.source.trim() ? 'declared' : 'not-provided', reliability: current?.[layer.key]?.reliability ?? 'estimated' } }))} placeholder="As-of date" /><select value={sourceDraft?.[layer.key]?.reliability ?? 'missing'} onChange={(event) => setSourceDraft((current) => ({ ...current, [layer.key]: { source: current?.[layer.key]?.source ?? '', asOf: current?.[layer.key]?.asOf, status: current?.[layer.key]?.source.trim() ? 'declared' : 'not-provided', reliability: event.target.value as 'verified' | 'estimated' | 'missing' } }))}><option value="verified">Verified</option><option value="estimated">Estimated</option><option value="missing">Missing</option></select></label>)}<div><button onClick={() => setSourceEditorOpen(false)}>Cancel</button><button className="save-sources-button" onClick={saveSourceRegister}>Save source register</button></div></div>}
          </section>}
          {savedCities.length > 0 && <section className="saved-cities"><span>SAVED CITY DATA</span>{savedCities.map((item) => <div key={item.id}><strong>{item.name}</strong><small>{item.wards.length} wards · imported</small><button onClick={() => { chooseCity(item.id); setImportOpen(false) }}>Open</button><button className="delete-city-button" onClick={() => deleteCity(item.id)}>Delete</button></div>)}</section>}
          <small>Start with the template, replace synthetic values with municipal sources, then import. Imported data is saved in this browser and labelled “imported” in the report.</small>
        </div>
      </section>}

      {showReport && winner ? (
        <section className="report-page">
          <div className="report-actions no-print">
            <button className="quiet-button" onClick={() => setShowReport(false)}><ArrowRight size={15} /> Back to studio</button>
            <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
          </div>
          <article className="report-document">
            <div className="report-kicker">{city.name.toUpperCase()} MUNICIPAL PLANNING NOTE · {city.dataStatus.toUpperCase()} DEMONSTRATION</div>
            <h1>{activeIsSchool ? <>School<br />site recommendation</> : <>Emergency hospital<br />site recommendation</>}</h1>
            <p className="report-intro">A transparent suitability assessment for a {activeCapacity}-{activeCapacityUnit} {activeIsSchool ? 'school' : 'emergency hospital'}, based on the <strong>{scenarioLabel}</strong> scenario.</p>
            <div className="report-meta"><span><b>Decision</b> {activeCapacity}-{activeCapacityUnit} {activeIsSchool ? 'school' : 'emergency hospital'}</span><span><b>Scenario</b> {scenarioLabel}</span><span><b>Dataset</b> {city.dataStatus === 'imported' ? 'Imported city package' : 'Synthetic city v0.1'}</span></div>
            {sourceRequest && <section className="request-trace"><span>ORIGINAL REQUEST</span><p>“{sourceRequest}”</p><small>Parsed into the confirmed assumptions below; the deterministic scoring engine selected the site.</small></section>}
            <section className="report-callout"><CheckCircle2 size={22} /><div><span>Recommended action</span><strong>{winner.name} — suitability score {winner.score}/100</strong><p>Approve a site-feasibility survey before procurement. It provides the best balance of access, unmet need, future growth, cost, and resilience.</p></div></section>
            <section className="decision-audit" aria-label="Decision evidence summary">
              <div><span>MAP MARKER</span><strong>{winner.id}</strong><small>Selected candidate parcel</small></div>
              <div><span>MAP REFERENCE</span><strong>{winner.location}</strong><small>{city.dataStatus === 'imported' ? 'Normalized map reference' : 'Synthetic map coordinate'} {winner.coordinates[0].toFixed(3)}, {winner.coordinates[1].toFixed(3)}</small></div>
              <div><span>{activeIsSchool ? 'WALK-TIME TEST' : 'RESPONSE TEST'}</span><strong>{winner.response}</strong><small className={responseGap <= 0 ? 'audit-pass' : 'audit-watch'}>{responseGap <= 0 ? `${Math.abs(responseGap).toFixed(1)} min inside target` : `${responseGap.toFixed(1)} min above target`}</small></div>
              <div><span>LAND PATHWAY</span><strong>{winner.ownership === 'municipal' ? 'Municipal parcel' : 'Private acquisition'}</strong><small>{winner.ownership === 'municipal' ? 'Title verification required' : `Estimated acquisition: ₹${winner.acquisitionCostLakhs} lakh`}</small></div>
            </section>
            <section className="evidence-section" aria-label="Recommendation benefits and concerns">
              <div className="evidence-card evidence-positive"><div className="evidence-heading"><CheckCircle2 size={18} /><div><span>WHY THIS SITE WORKS</span><strong>Planning strengths</strong></div></div><ul>{siteBenefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul></div>
              <div className="evidence-card evidence-concern"><div className="evidence-heading"><ShieldAlert size={18} /><div><span>CONCERNS TO RESOLVE</span><strong>Before approval</strong></div></div><ul>{siteConcerns.map((concern) => <li key={concern}>{concern}</li>)}</ul></div>
            </section>
            <div className="report-grid">
              <section><h2>Decision context</h2><p>{city.dataStatus === 'imported' ? `This recommendation uses the imported ${city.wards.length}-ward dataset, supplied road network, parcel data, and flood-risk geometry. Confirm provenance before an official decision.` : activeIsSchool ? 'School demand is strongest in the growing north-east wards, while the civic core already has better coverage. Safe access and monsoon resilience are considered alongside land feasibility.' : 'Existing care centres are concentrated in the civic core. The rail–MIDC corridor has the strongest projected demand increase, while the southern edge carries a river-disruption risk.'}</p><h2>Confirmed {activeIsSchool ? 'school' : 'hospital'} brief</h2><ul><li><b>Capacity:</b> {activeCapacity} {activeCapacityUnit}.</li><li><b>Land requirement:</b> at least {Math.max(activeMinimumLand, Math.ceil(activeCapacity / (activeIsSchool ? 8 : 20)))} acres.</li><li><b>{activeIsSchool ? 'Walking target' : 'Response target'}:</b> {activeTimeTarget} minutes.</li><li><b>Budget:</b> ₹{activeBudget} lakh.</li><li><b>Land policy:</b> {activeLandPreference === 'municipal' ? 'municipal land only.' : 'municipal preferred; acquisition allowed.'}</li></ul></section>
              <section><h2>Active planning conditions</h2><dl><dt>Population growth</dt><dd>{activeConditions.populationGrowthPercent}%</dd><dt>River-risk buffer</dt><dd>{activeConditions.riverRisk}</dd><dt>Road disruption</dt><dd>{activeConditions.roadDisruption.replaceAll('-', ' ')}</dd><dt>Data status</dt><dd>{city.dataStatus}</dd></dl><h2>Score weights</h2><dl><dt>{activeIsSchool ? 'Safe access' : 'Travel-time coverage'}</dt><dd>{activeWeights.travel * 100}%</dd><dt>{activeIsSchool ? 'School-access gap' : 'Underserved population'}</dt><dd>{activeWeights.need * 100}%</dd><dt>Future growth</dt><dd>{activeWeights.growth * 100}%</dd><dt>Land / cost</dt><dd>{activeWeights.cost * 100}%</dd><dt>Resilience</dt><dd>{activeWeights.resilience * 100}%</dd></dl></section>
            </div>
            {city.dataStatus === 'imported' && <section className="provenance-report"><div><span>DATA PROVENANCE REGISTER</span><h2>Declared sources for this package</h2><p>These source declarations were supplied with the imported city package or entered in the studio. They must be checked against original municipal records before use in an official decision.</p></div><table><thead><tr><th>Layer</th><th>Declared source</th><th>As of</th><th>Reliability</th></tr></thead><tbody>{reportProvenance.map((layer) => <tr key={layer.key}><td><strong>{layer.label}</strong></td><td>{layer.declared ? layer.entry?.source : 'No source declared'}</td><td>{layer.declared ? layer.entry?.asOf || 'Not specified' : '—'}</td><td><span className={`provenance-${layer.reliability}`}>{layer.reliability}</span></td></tr>)}</tbody></table></section>}
            <section><h2>Candidate comparison</h2><table><thead><tr><th>Rank</th><th>Site</th><th>Score</th><th>Coverage</th><th>Primary trade-off</th></tr></thead><tbody>{ranked.map((candidate, index) => <tr key={candidate.id}><td>{candidate.excluded ? '—' : index + 1}</td><td><strong>{candidate.name}</strong><small>{candidate.location} · {candidate.siteAreaAcres} acres · {candidate.ownership} land</small></td><td>{candidate.excluded ? <small>{candidate.exclusionReasons.join(' ')}</small> : `${candidate.score}/100`}</td><td>{candidate.served}</td><td>{candidate.tradeoff}</td></tr>)}</tbody></table></section>
            <section className="report-execution"><div><h2>Implementation sequence</h2><ol><li><b>Validate parcel.</b> Confirm municipal ownership, site area, and permitted land use.</li><li><b>Run field survey.</b> {activeIsSchool ? 'Verify student demand, safe walking routes, crossings, and nearby school capacity.' : 'Verify emergency demand, access, ambulance routes, and hospital capacity.'}</li><li><b>Approve procurement.</b> Carry the verified inputs into a detailed feasibility and budget review.</li></ol></div><div><h2>Required evidence</h2><ul><li>Land-record and zoning documents</li><li>Official flood and drainage layer</li>{activeIsSchool ? <><li>School enrolment and classroom-capacity records</li><li>Safe walking-route and crossing survey</li></> : <><li>Ambulance response-time records</li><li>Ward population and hospital-bed data</li></>}</ul></div></section>
            <footer>Generated by NavaNagar Planning Studio · {city.dataStatus === 'imported' ? 'Imported data package — municipal sources must be verified before official use.' : 'Synthetic demonstration dataset · Validate all inputs before real-world use.'}</footer>
          </article>
        </section>
      ) : (
        <section className="studio-layout">
          <aside className="command-panel">
            <div className="eyebrow"><RadioTower size={14} /> CITY PLANNING STUDIO</div>
            <h1>What should<br />the <i>city</i><br />plan next?</h1>
            <p className="panel-copy">Choose a planning template, review its evidence requirements, and use a transparent engine where one is available.</p>
            <section className="template-launcher">
              <div><span>ACTIVE ENGINE</span><strong>{activeIsSchool ? 'School site selection' : 'Hospital site selection'}</strong><small>Transparent parcel recommendation</small></div>
              <button onClick={() => setTemplateCatalogOpen(!templateCatalogOpen)} aria-expanded={templateCatalogOpen}>{templateCatalogOpen ? 'Close' : 'Explore'} templates <ChevronRight size={14} /></button>
            </section>
            {templateCatalogOpen && <section className="template-catalog" aria-label="Planning templates">
              <div className="template-catalog-heading"><span>PLANNING TEMPLATES</span><small>Availability is explicit</small></div>
              {planningTemplates.filter((template) => template.id !== 'custom').map((template) => { const TemplateIcon = templateIcons[template.id]; return <button key={template.id} className={`template-card ${template.availability} ${activeTemplateId === template.id ? 'selected' : ''}`} onClick={() => selectPlanningTemplate(template.id)}><TemplateIcon size={15} /><span><strong>{template.label}</strong><small>{template.mode.replaceAll('-', ' ')} · {template.availability.replace('-', ' ')}</small><em>{template.note}</em></span></button> })}
              <p className="template-notice">{templateNotice}</p>
            </section>}
            <div className="scenario-list">
              <div className="section-label">PLANNING SCENARIO</div>
              {scenarios.map((item) => <button key={item.id} className={`scenario-option ${scenario === item.id ? 'active' : ''}`} onClick={() => chooseScenario(item.id)}><span className="scenario-radio" /><span><strong>{item.label}</strong><small>{item.note}</small></span></button>)}
            </div>
            <button className="request-button" onClick={() => setRequestOpen(!requestOpen)} aria-expanded={requestOpen}>
              <span><WandSparkles size={14} /> Describe your planning need</span><ChevronRight size={15} />
            </button>
            {requestOpen && <section className="request-panel">
              <p>Describe the project in plain language. Hospital and School requests activate their working templates; other planning types become structured briefs until their specialist engines are enabled.</p>
              <textarea value={requestText} onChange={(event) => { setRequestText(event.target.value); setInterpretation(null); setPlanningBrief(null) }} placeholder="Example: I need a 100-bed emergency hospital… or a school for growing north-east wards… or a safer road corridor." />
              <button className="interpret-button" onClick={interpretRequest} disabled={!requestText.trim()}><WandSparkles size={14} /> Interpret request</button>
              {interpretation && <div className="interpretation-result">
                <span>PROPOSED ASSUMPTIONS</span>
                {interpretation.recognized.length > 0 ? <ul className="recognized-list">{interpretation.recognized.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="empty-interpretation">No specific values recognised. Review the retained defaults below.</p>}
                <ul className="defaults-list">{interpretation.defaultsKept.map((item) => <li key={item}>{item}</li>)}</ul>
                <button className="apply-request-button" onClick={applyInterpretation}>Apply for review <ChevronRight size={14} /></button>
              </div>}
              {planningBrief && <div className="planning-brief-result"><span>STRUCTURED PLANNING BRIEF</span><h3>{planningBrief.title}</h3><p><b>{planningBrief.mode.replaceAll('-', ' ')}</b> · {planningBrief.availability === 'next' ? 'next specialist template' : 'brief-only template'}</p><strong>Decision to prepare</strong><p className="brief-question">{planningBrief.decisionQuestion}</p><strong>Data required before recommendation</strong><ul>{planningBrief.requiredData.map((item) => <li key={item}>{item}</li>)}</ul><small><b>Why no score yet:</b> {planningBrief.engineBoundary}</small><small>{planningBrief.nextStep}</small><button className="apply-request-button" onClick={applyPlanningBrief}>Keep as planning brief <ChevronRight size={14} /></button></div>}
            </section>}
            <button className="brief-button" onClick={() => setBriefOpen(!briefOpen)} aria-expanded={briefOpen}>
              <span><SlidersHorizontal size={14} /> Review active {activeIsSchool ? 'school' : 'hospital'} assumptions</span><ChevronRight size={15} />
            </button>
            {briefOpen && <section className="brief-panel">
              {activeIsSchool ? <>
              <p className="brief-intro">These school inputs are used by the deterministic siting engine. Editing one marks the previous recommendation as outdated.</p>
              <div className="brief-grid">
                <label><span>Classrooms</span><input type="number" min="4" max="80" step="2" value={activeSchoolRequest.facilityProfile.classrooms} onChange={(event) => updateSchoolRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, classrooms: Number(event.target.value) } }))} /></label>
                <label><span>Min. acres</span><input type="number" min="1" max="10" step="0.1" value={activeSchoolRequest.facilityProfile.minimumLandArea} onChange={(event) => updateSchoolRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, minimumLandArea: Number(event.target.value) } }))} /></label>
                <label><span>Walk target</span><input type="number" min="5" max="30" step="1" value={activeSchoolRequest.facilityProfile.targetWalkTime} onChange={(event) => updateSchoolRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, targetWalkTime: Number(event.target.value) } }))} /></label>
                <label><span>Budget ₹ lakh</span><input type="number" min="100" max="5000" step="50" value={activeSchoolRequest.facilityProfile.budgetLakhs} onChange={(event) => updateSchoolRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, budgetLakhs: Number(event.target.value) } }))} /></label>
              </div>
              <label className="brief-select"><span>Land preference</span><select value={activeSchoolRequest.facilityProfile.landPreference} onChange={(event) => updateSchoolRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, landPreference: event.target.value as SchoolPlanningRequest['facilityProfile']['landPreference'] } }))}><option value="acquisition-allowed">Municipal preferred; acquisition allowed</option><option value="municipal">Municipal land only</option></select></label>
              <label className="brief-select"><span>Population growth</span><select value={activeSchoolRequest.conditions.populationGrowthPercent} onChange={(event) => updateSchoolRequest((current) => ({ ...current, conditions: { ...current.conditions, populationGrowthPercent: Number(event.target.value) } }))}><option value="0">No additional growth</option><option value="10">10% projected growth</option><option value="20">20% projected growth</option><option value="30">30% projected growth</option></select></label>
              <label className="brief-select"><span>River risk</span><select value={activeSchoolRequest.conditions.riverRisk} onChange={(event) => updateSchoolRequest((current) => ({ ...current, conditions: { ...current.conditions, riverRisk: event.target.value as SchoolPlanningRequest['conditions']['riverRisk'] } }))}><option value="normal">Normal river buffer</option><option value="expanded">Expanded monsoon buffer</option></select></label>
              <label className="brief-select"><span>Road disruption</span><select value={activeSchoolRequest.conditions.roadDisruption} onChange={(event) => updateSchoolRequest((current) => ({ ...current, conditions: { ...current.conditions, roadDisruption: event.target.value as SchoolPlanningRequest['conditions']['roadDisruption'] } }))}><option value="none">No disruption</option><option value="north-east-corridor">North-east corridor disruption</option><option value="south-bypass">South bypass disruption</option></select></label>
              </> : <>
              <p className="brief-intro">These are the confirmed inputs used by the scoring engine. Editing one marks the previous recommendation as outdated.</p>
              <div className="brief-grid">
                <label><span>Beds</span><input type="number" min="10" max="250" step="10" value={activeRequest.facilityProfile.beds} onChange={(event) => updateRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, beds: Number(event.target.value) } }))} /></label>
                <label><span>Min. acres</span><input type="number" min="1" max="10" step="0.1" value={activeRequest.facilityProfile.minimumLandArea} onChange={(event) => updateRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, minimumLandArea: Number(event.target.value) } }))} /></label>
                <label><span>Target mins</span><input type="number" min="5" max="30" step="1" value={activeRequest.facilityProfile.targetResponseTime} onChange={(event) => updateRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, targetResponseTime: Number(event.target.value) } }))} /></label>
                <label><span>Budget ₹ lakh</span><input type="number" min="100" max="5000" step="50" value={activeRequest.facilityProfile.budgetLakhs} onChange={(event) => updateRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, budgetLakhs: Number(event.target.value) } }))} /></label>
              </div>
              <label className="brief-select"><span>Land preference</span><select value={activeRequest.facilityProfile.landPreference} onChange={(event) => updateRequest((current) => ({ ...current, facilityProfile: { ...current.facilityProfile, landPreference: event.target.value as PlanningRequest['facilityProfile']['landPreference'] } }))}><option value="acquisition-allowed">Municipal preferred; acquisition allowed</option><option value="municipal">Municipal land only</option></select></label>
              <label className="brief-select"><span>Population growth</span><select value={activeRequest.conditions.populationGrowthPercent} onChange={(event) => updateRequest((current) => ({ ...current, conditions: { ...current.conditions, populationGrowthPercent: Number(event.target.value) } }))}><option value="0">No additional growth</option><option value="10">10% projected growth</option><option value="20">20% projected growth</option><option value="30">30% projected growth</option></select></label>
              <label className="brief-select"><span>River risk</span><select value={activeRequest.conditions.riverRisk} onChange={(event) => updateRequest((current) => ({ ...current, conditions: { ...current.conditions, riverRisk: event.target.value as PlanningRequest['conditions']['riverRisk'] } }))}><option value="normal">Normal river buffer</option><option value="expanded">Expanded monsoon buffer</option></select></label>
              <label className="brief-select"><span>Road disruption</span><select value={activeRequest.conditions.roadDisruption} onChange={(event) => updateRequest((current) => ({ ...current, conditions: { ...current.conditions, roadDisruption: event.target.value as PlanningRequest['conditions']['roadDisruption'] } }))}><option value="none">No disruption</option><option value="north-east-corridor">North-east corridor disruption</option><option value="south-bypass">South bypass disruption</option></select></label>
              </>}
            </section>}
            <button className="method-button" onClick={() => setMethodOpen(!methodOpen)} aria-expanded={methodOpen}>
              <span><CircleAlert size={14} /> Method & assumptions</span><ChevronRight size={15} />
            </button>
            {methodOpen && <section className="method-panel">
              <div><span>Inputs</span><p>{activeIsSchool ? 'Student demand, existing school coverage, safe access, growth, parcel cost, and river risk.' : 'Ward demand, hospital coverage, road access, growth, parcel cost, and river risk.'}</p></div>
              <div><span>Active request</span><p>{activeCapacity}-{activeCapacityUnit} {activeIsSchool ? 'school' : 'hospital'} · {activeMinimumLand}-acre minimum · {activeConditions.populationGrowthPercent}% growth · {activeConditions.riverRisk} river risk.</p></div>
              <div><span>Weights</span><p>Access {activeWeights.travel * 100} · need {activeWeights.need * 100} · growth {activeWeights.growth * 100} · cost {activeWeights.cost * 100} · resilience {activeWeights.resilience * 100}.</p></div>
              <div className="method-rule"><ShieldAlert size={14} /><p>Hard rule: undersized, prohibited, or monsoon-unsafe parcels are excluded before ranking. Private land carries an acquisition penalty.</p></div>
            </section>}
            <button className="run-button" onClick={runRecommendation} disabled={Boolean(activePlanningBrief) || activeAnalysis.state === 'needs-data'} title={activePlanningBrief ? 'A specialist engine is required for this planning brief.' : activeAnalysis.state === 'needs-data' ? 'This city package needs school data before analysis.' : undefined}><span>{activePlanningBrief ? 'Specialist engine required' : activeAnalysis.state === 'needs-data' ? 'School data required' : hasRun ? 'Re-run active analysis' : 'Analyse active proposal'}</span><ArrowRight size={18} /></button>
            <p className="disclaimer"><CircleAlert size={13} /> Hyderabad is real base geography. AI-assisted map zones are illustrative draft assumptions, not municipal records or verified parcels.</p>
          </aside>

          <section className="map-section">
            <HyderabadBaseMap />
            <div className="map-title"><span>HYDERABAD / AI-ASSISTED SCENARIO</span><strong>OpenStreetMap base · draft planning assumptions</strong></div>
            <div className="real-map-note"><span>AI-ASSISTED DRAFT</span><p>Zones, risk corridor, and three candidate points are illustrative estimates. They are not verified demand, land, or hazard records.</p></div>
            <div className="map-legend real-map-legend"><span><i className="dot real" /> OpenStreetMap geography</span><span><i className="dot ai-zone" /> Draft access/demand zone</span><span><i className="dot ai-site" /> Draft candidate point</span></div>
          </section>

          <aside className={`analysis-panel ${hasRun ? 'is-ready' : ''}`}>
            {activePlanningBrief ? <div className="awaiting planning-brief-awaiting"><WandSparkles size={22} /><span>PLANNING BRIEF READY</span><h2>{activePlanningBrief.title}</h2><p>{activePlanningBrief.decisionQuestion}</p>{sourceRequest && <p className="brief-request">Request: “{sourceRequest}”</p>}<ul>{activePlanningBrief.requiredData.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul><small><b>Engine boundary:</b> {activePlanningBrief.engineBoundary}</small><small>{activePlanningBrief.nextStep}</small></div> : activeAnalysis.state === 'needs-data' ? <div className="awaiting planning-brief-awaiting"><School size={22} /><span>SCHOOL DATA REQUIRED</span><h2>School template cannot run for this city yet</h2><p>Imported cities need student demand, school coverage, safe-access, and school candidate metrics before a recommendation is valid.</p><small>Use the municipal mapping worksheet and import a city package with these verified fields.</small></div> : !hasRun ? <div className="awaiting"><Menu size={22} /><h2>Recommendation pending</h2><p>Run the active {activeIsSchool ? 'School' : 'Hospital'} engine to compare the current planning conditions.</p></div> : !winner ? <div className="awaiting no-site"><ShieldAlert size={22} /><h2>No viable parcel</h2><p>The current assumptions exclude every candidate site. Relax a condition and run the recommendation again.</p></div> : <>
              <div className="analysis-header"><span>RECOMMENDATION OUTPUT</span><span className="status-badge"><CheckCircle2 size={13} /> READY</span></div>
              <div className="winner-card"><div className="winner-index">01</div><div><p>Recommended site</p><h2>{winner.name}</h2><span>{winner.location}</span></div><div className="score"><strong>{winner.score}</strong><span>/100</span><small>SUITABILITY</small></div></div>
              <div className="impact-row"><div><span>{activeIsSchool ? 'Students reached' : 'People reached'}</span><strong>{winner.served}</strong></div><div><span>{activeIsSchool ? 'Walking time' : 'Response time'}</span><strong>{winner.response}</strong></div></div>
              <p className="why"><ShieldAlert size={17} /><span><strong>Why it wins</strong>{winner.tradeoff}</span></p>
              <div className="score-breakdown"><div className="section-label">SCORE BREAKDOWN</div>{[
                [activeIsSchool ? 'Safe access' : 'Travel-time coverage', winner.travel, '#d8e674'], [activeIsSchool ? 'School-access gap' : 'Unmet need', winner.need, '#7dc8a6'], ['Future growth', winner.growth, '#8ab7de'], ['Land / cost', winner.cost, '#edc878'], ['Resilience', winner.resilience, '#e68e78'],
              ].map(([name, value, colour]) => <div className="metric" key={String(name)}><div><span>{name}</span><b>{value}</b></div><span className="meter"><i style={{ width: `${value}%`, backgroundColor: String(colour) }} /></span></div>)}</div>
              <button className="report-button" onClick={openReport}><FileText size={16} /> Generate planning report <ChevronRight size={16} /></button>
            </>}
          </aside>
        </section>
      )}
      <footer className="city-strip"><div><span>{activePlanningBrief ? 'CITY PLANNING READINESS' : activeIsSchool ? 'CITY EDUCATION INDEX' : 'CITY HEALTH INDEX'}</span><strong>{activePlanningBrief ? cityDataQuality.structuralCount * 20 : activeIsSchool ? 72 : 74}<span>/100</span></strong></div>{activePlanningBrief ? <><div><Layers3 size={16} /><span>Evidence layers <b>{cityDataQuality.structuralCount}/5</b></span></div><div><WandSparkles size={16} /><span>Decision mode <b>{activePlanningBrief.mode.replaceAll('-', ' ')}</b></span></div><div><ShieldAlert size={16} /><span>Engine <b>specialist needed</b></span></div></> : activeIsSchool ? <><div><Route size={16} /><span>Safe access <b>67</b></span></div><div><School size={16} /><span>School coverage <b>69</b></span></div><div><Waves size={16} /><span>Climate resilience <b>68</b></span></div></> : <><div><Route size={16} /><span>Emergency access <b>62</b></span></div><div><Hospital size={16} /><span>Care capacity <b>71</b></span></div><div><Waves size={16} /><span>Climate resilience <b>68</b></span></div></>}<div className="strip-note">{city.wards.length} wards · {activePlanningBrief ? `${activePlanningBrief.templateId.replaceAll('-', ' ')} brief` : activeIsSchool ? `${city.schools?.length ?? 0} schools` : `${city.hospitals.length} care centres`} · {city.candidates.length} candidate parcels · {city.dataStatus}</div></footer>
    </main>
  )
}

export default App
