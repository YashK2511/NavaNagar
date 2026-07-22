import type { Candidate, CityDataset, DatasetLayer, Ward } from '../types'

const isPoint = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number')

type GeoFeature = { type: 'Feature'; properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } | null }
type GeoCollection = { type: 'FeatureCollection'; features: GeoFeature[] }

const packageFiles = ['city.json', 'wards.geojson', 'roads.geojson', 'facilities.geojson', 'candidate_sites.geojson', 'risk_zones.geojson'] as const
const candidatePropertyFields = ['id', 'name', 'location', 'ownership', 'siteAreaAcres', 'acquisitionCostLakhs', 'landUseAllowed', 'roadAccessScore', 'floodRisk', 'serviceCorridor', 'travel', 'need', 'growth', 'cost', 'resilience', 'served', 'response', 'tradeoff'] as const

const asCollection = (value: unknown): GeoCollection | undefined => value && typeof value === 'object' && (value as { type?: string }).type === 'FeatureCollection' && Array.isArray((value as { features?: unknown }).features) ? value as GeoCollection : undefined
const propertiesOf = (feature: GeoFeature) => feature.properties ?? {}
const polygonRing = (feature: GeoFeature): [number, number][] | undefined => {
  const geometry = feature.geometry
  if (!geometry) return undefined
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0]) && geometry.coordinates[0].every(isPoint)) return geometry.coordinates[0] as [number, number][]
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0]) && Array.isArray(geometry.coordinates[0][0]) && geometry.coordinates[0][0].every(isPoint)) return geometry.coordinates[0][0] as [number, number][]
  return undefined
}
const pointOf = (feature: GeoFeature): [number, number] | undefined => {
  const geometry = feature.geometry
  if (!geometry) return undefined
  if (geometry.type === 'Point' && isPoint(geometry.coordinates)) return geometry.coordinates
  const ring = polygonRing(feature)
  if (!ring) return undefined
  const unclosed = ring.slice(0, ring.length > 1 ? -1 : undefined)
  return [unclosed.reduce((sum, coordinate) => sum + coordinate[0], 0) / unclosed.length, unclosed.reduce((sum, coordinate) => sum + coordinate[1], 0) / unclosed.length]
}
const lineOf = (feature: GeoFeature): [number, number][][] => {
  const geometry = feature.geometry
  if (!geometry) return []
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.every(isPoint)) return [geometry.coordinates]
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates.filter((line): line is [number, number][] => Array.isArray(line) && line.every(isPoint))
  return []
}
const numberProperty = (properties: Record<string, unknown>, key: string) => typeof properties[key] === 'number' && Number.isFinite(properties[key]) ? properties[key] : undefined
const stringProperty = (properties: Record<string, unknown>, key: string) => typeof properties[key] === 'string' && properties[key].trim() ? properties[key].trim() : undefined

function normalizeCityCoordinates(city: CityDataset): CityDataset {
  const allPoints = [
    ...city.wards.flatMap((ward) => ward.coordinates), ...city.roads.flat(), ...city.river,
    ...city.hospitals.map((hospital) => hospital.coordinates), ...(city.schools ?? []).map((school) => school.coordinates), ...city.candidates.map((candidate) => candidate.coordinates),
  ]
  const xs = allPoints.map((point) => point[0])
  const ys = allPoints.map((point) => point[1])
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2
  const range = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), .00001)
  const point = ([x, y]: [number, number]): [number, number] => [Number((((x - centreX) / range) * .17).toFixed(4)), Number((((y - centreY) / range) * .17).toFixed(4))]
  return {
    ...city,
    wards: city.wards.map((ward) => ({ ...ward, coordinates: ward.coordinates.map(point) })),
    roads: city.roads.map((road) => road.map(point)),
    river: city.river.map(point),
    hospitals: city.hospitals.map((hospital) => ({ ...hospital, coordinates: point(hospital.coordinates) })),
    schools: city.schools?.map((school) => ({ ...school, coordinates: point(school.coordinates) })),
    candidates: city.candidates.map((candidate) => ({ ...candidate, coordinates: point(candidate.coordinates) })),
  }
}

export async function importGeoJsonPackage(files: File[]): Promise<{ city?: CityDataset; errors: string[] }> {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]))
  const missing = packageFiles.filter((name) => !byName.has(name))
  if (missing.length) return { errors: [`Missing required file${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`] }
  try {
    const parsed = Object.fromEntries(await Promise.all(packageFiles.map(async (name) => [name, JSON.parse(await byName.get(name)!.text())]))) as Record<(typeof packageFiles)[number], unknown>
    if (!parsed['city.json'] || typeof parsed['city.json'] !== 'object') return { errors: ['city.json must be a JSON object with id, name, and scale.'] }
    const metadata = parsed['city.json'] as Record<string, unknown>
    const wards = asCollection(parsed['wards.geojson'])
    const roads = asCollection(parsed['roads.geojson'])
    const facilities = asCollection(parsed['facilities.geojson'])
    const candidates = asCollection(parsed['candidate_sites.geojson'])
    const risks = asCollection(parsed['risk_zones.geojson'])
    if (!wards || !roads || !facilities || !candidates || !risks) return { errors: ['Each GeoJSON layer must be a FeatureCollection.'] }
    if (!stringProperty(metadata, 'id') || !stringProperty(metadata, 'name') || !stringProperty(metadata, 'scale')) return { errors: ['city.json requires non-empty id, name, and scale.'] }

    const wardData: Ward[] = wards.features.flatMap((feature) => {
      const properties = propertiesOf(feature)
      const coordinates = polygonRing(feature)
      const values = ['density', 'population', 'populationGrowth', 'emergencyDemand', 'existingHospitalCoverage'].map((key) => numberProperty(properties, key))
      const name = stringProperty(properties, 'name')
      return coordinates && name && values.every((value) => value !== undefined) ? [{ name, density: values[0]!, population: values[1]!, populationGrowth: values[2]!, emergencyDemand: values[3]!, existingHospitalCoverage: values[4]!, schoolAgeDemand: numberProperty(properties, 'schoolAgeDemand'), existingSchoolCoverage: numberProperty(properties, 'existingSchoolCoverage'), coordinates }] : []
    })
    if (!wardData.length || wardData.length !== wards.features.length) return { errors: ['Every wards.geojson feature needs Polygon geometry plus name, density, population, populationGrowth, emergencyDemand, and existingHospitalCoverage.'] }
    const roadData = roads.features.flatMap(lineOf)
    if (!roadData.length) return { errors: ['roads.geojson needs at least one LineString or MultiLineString feature.'] }
    const facilityData = facilities.features.flatMap((feature, index) => {
      const coordinates = pointOf(feature)
      const properties = propertiesOf(feature)
      return coordinates ? [{ name: stringProperty(properties, 'name') ?? `Facility ${index + 1}`, kind: stringProperty(properties, 'kind')?.toLowerCase(), coordinates }] : []
    })
    if (!facilityData.length) return { errors: ['facilities.geojson needs at least one Point feature with a name.'] }
    const candidateData: Candidate[] = candidates.features.flatMap((feature) => {
      const properties = propertiesOf(feature)
      const coordinates = pointOf(feature)
      const missingProperties = candidatePropertyFields.filter((key) => properties[key] === undefined)
      if (!coordinates || missingProperties.length) return []
      const nestedSchool = properties.school
      const school = nestedSchool && typeof nestedSchool === 'object' && ['access', 'need', 'growth', 'served', 'walkTime', 'tradeoff'].every((key) => key in nestedSchool) ? nestedSchool as Candidate['school'] : undefined
      return [{
        id: properties.id, name: properties.name, location: properties.location, coordinates, ownership: properties.ownership,
        siteAreaAcres: properties.siteAreaAcres, acquisitionCostLakhs: properties.acquisitionCostLakhs, landUseAllowed: properties.landUseAllowed,
        roadAccessScore: properties.roadAccessScore, floodRisk: properties.floodRisk, serviceCorridor: properties.serviceCorridor,
        travel: properties.travel, need: properties.need, growth: properties.growth, cost: properties.cost, resilience: properties.resilience,
        served: properties.served, response: properties.response, tradeoff: properties.tradeoff, school,
      } as Candidate]
    })
    if (candidateData.length !== candidates.features.length || !['A', 'B', 'C'].every((id) => candidateData.some((candidate) => candidate.id === id))) return { errors: ['candidate_sites.geojson must provide A, B, and C parcels with Point or Polygon geometry and all required planning properties. Download the quick template to see the property contract.'] }
    const riskFeature = risks.features.find((feature) => polygonRing(feature))
    const river = riskFeature ? polygonRing(riskFeature) : undefined
    if (!river) return { errors: ['risk_zones.geojson needs one Polygon or MultiPolygon flood/river-risk feature.'] }
    const city: CityDataset = {
      id: stringProperty(metadata, 'id')!, name: stringProperty(metadata, 'name')!, scale: stringProperty(metadata, 'scale')!, dataStatus: 'imported',
      wards: wardData, roads: roadData, hospitals: facilityData.filter((facility) => facility.kind !== 'school').map(({ name, coordinates }) => ({ name, coordinates })), schools: facilityData.filter((facility) => facility.kind === 'school').map(({ name, coordinates }) => ({ name, coordinates })), candidates: candidateData, river,
      provenance: typeof metadata.provenance === 'object' && metadata.provenance && !Array.isArray(metadata.provenance) ? metadata.provenance as CityDataset['provenance'] : undefined,
    }
    return { city: normalizeCityCoordinates(city), errors: [] }
  } catch {
    return { errors: ['One or more selected files could not be read as valid JSON or GeoJSON.'] }
  }
}

const qualityLayers: Array<{ key: DatasetLayer; label: string; ready: (city: CityDataset) => boolean }> = [
  { key: 'wards', label: 'Wards and population attributes', ready: (city) => city.wards.length > 0 },
  { key: 'roads', label: 'Road network', ready: (city) => city.roads.length > 0 },
  { key: 'facilities', label: 'Existing facilities', ready: (city) => city.hospitals.length > 0 || (city.schools?.length ?? 0) > 0 },
  { key: 'candidateSites', label: 'Candidate planning parcels', ready: (city) => city.candidates.length >= 3 },
  { key: 'riskZones', label: 'River / flood-risk geometry', ready: (city) => city.river.length > 0 },
]

export function getCityDataQuality(city: CityDataset) {
  const layers = qualityLayers.map((layer) => ({
    ...layer,
    structuralReady: layer.ready(city),
    provenanceDeclared: city.provenance?.[layer.key]?.status === 'declared' && Boolean(city.provenance[layer.key]?.source.trim()),
    reliability: city.provenance?.[layer.key]?.reliability ?? 'missing',
  }))
  return {
    layers,
    structuralCount: layers.filter((layer) => layer.structuralReady).length,
    provenanceCount: layers.filter((layer) => layer.provenanceDeclared).length,
  }
}

export function validateCityImport(value: unknown): { city?: CityDataset; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object') return { errors: ['The file must contain a JSON object.'] }
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.scale !== 'string') errors.push('Required city fields: id, name, scale.')
  if (!Array.isArray(data.candidates) || data.candidates.length < 3) errors.push('At least three candidate parcels are required.')
  if (!Array.isArray(data.wards) || data.wards.length === 0) errors.push('At least one ward is required.')
  if (!Array.isArray(data.roads) || data.roads.length === 0) errors.push('At least one road line is required.')
  if (!Array.isArray(data.river) || !data.river.every(isPoint)) errors.push('River must be an array of [longitude, latitude] coordinates.')
  if ((!Array.isArray(data.hospitals) || data.hospitals.length === 0) && (!Array.isArray(data.schools) || data.schools.length === 0)) errors.push('At least one existing facility is required.')
  if (data.provenance !== undefined && (!data.provenance || typeof data.provenance !== 'object' || Array.isArray(data.provenance))) errors.push('Provenance must be an object when provided.')
  if (Array.isArray(data.candidates)) {
    const ids = data.candidates.map((item) => typeof item === 'object' && item ? (item as Record<string, unknown>).id : undefined)
    if (!['A', 'B', 'C'].every((id) => ids.includes(id))) errors.push('Candidate parcel ids A, B, and C are required for this demo scorer.')
    const candidateFields = ['name', 'location', 'coordinates', 'ownership', 'siteAreaAcres', 'acquisitionCostLakhs', 'landUseAllowed', 'roadAccessScore', 'floodRisk', 'serviceCorridor', 'travel', 'need', 'growth', 'cost', 'resilience', 'served', 'response', 'tradeoff']
    if (data.candidates.some((item) => !item || typeof item !== 'object' || candidateFields.some((field) => !(field in item)))) errors.push('Each candidate needs its geometry, ownership, risk, access, cost, and scoring fields.')
  }
  if (Array.isArray(data.wards) && data.wards.some((item) => !item || typeof item !== 'object' || !Array.isArray((item as Record<string, unknown>).coordinates))) errors.push('Each ward needs boundary coordinates and planning attributes.')
  if (Array.isArray(data.hospitals) && data.hospitals.some((item) => !item || typeof item !== 'object' || !isPoint((item as Record<string, unknown>).coordinates))) errors.push('Each care centre needs a name and [longitude, latitude] coordinate.')
  if (Array.isArray(data.schools) && data.schools.some((item) => !item || typeof item !== 'object' || !isPoint((item as Record<string, unknown>).coordinates))) errors.push('Each school needs a name and [longitude, latitude] coordinate.')
  if (errors.length > 0) return { errors }
  return { city: { ...(data as unknown as CityDataset), dataStatus: 'imported' }, errors: [] }
}
