import type { FeatureCollection, LineString, Point, Polygon } from 'geojson'

export type HyderabadScenarioDraft = {
  summary: string
  zones: Array<{ label: string; rationale: string; priority: 'high' | 'medium'; polygon: [number, number][] }>
  candidates: Array<{ id: 'A' | 'B' | 'C'; label: string; note: string; coordinates: [number, number] }>
  riskCorridor: [number, number][]
}

type DraftZoneProperties = {
  label: string
  rationale: string
  priority: 'high' | 'medium'
}

type DraftCandidateProperties = {
  id: string
  label: string
  note: string
}

// AI-assisted demonstration assumptions, drafted from broad city context only.
// They are not official demand, land, ownership, hazard, or parcel records.
export const hyderabadDraftDemandZones: FeatureCollection<Polygon, DraftZoneProperties> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { label: 'West employment access gap', rationale: 'Illustrative growth-and-access scenario near the western employment corridor.', priority: 'high' }, geometry: { type: 'Polygon', coordinates: [[[78.331, 17.424], [78.385, 17.424], [78.385, 17.461], [78.331, 17.461], [78.331, 17.424]]] } },
    { type: 'Feature', properties: { label: 'North-west residential demand', rationale: 'Illustrative residential-growth scenario for demonstration only.', priority: 'medium' }, geometry: { type: 'Polygon', coordinates: [[[78.383, 17.47], [78.441, 17.47], [78.441, 17.512], [78.383, 17.512], [78.383, 17.47]]] } },
    { type: 'Feature', properties: { label: 'East growth access gap', rationale: 'Illustrative east-side access scenario; requires official service and travel data.', priority: 'high' }, geometry: { type: 'Polygon', coordinates: [[[78.544, 17.38], [78.602, 17.38], [78.602, 17.424], [78.544, 17.424], [78.544, 17.38]]] } },
  ],
}

export const hyderabadDraftCandidates: FeatureCollection<Point, DraftCandidateProperties> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: 'A', label: 'West connector draft', note: 'Illustrative map point only — not a verified parcel.' }, geometry: { type: 'Point', coordinates: [78.366, 17.443] } },
    { type: 'Feature', properties: { id: 'B', label: 'North access draft', note: 'Illustrative map point only — not a verified parcel.' }, geometry: { type: 'Point', coordinates: [78.414, 17.492] } },
    { type: 'Feature', properties: { id: 'C', label: 'East growth draft', note: 'Illustrative map point only — not a verified parcel.' }, geometry: { type: 'Point', coordinates: [78.574, 17.401] } },
  ],
}

export const hyderabadDraftRiskCorridor: FeatureCollection<LineString, { label: string }> = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { label: 'Illustrative water-risk review corridor' }, geometry: { type: 'LineString', coordinates: [[78.387, 17.376], [78.442, 17.38], [78.497, 17.37], [78.552, 17.38]] } }],
}

export function scenarioToMapLayers(draft: HyderabadScenarioDraft) {
  return {
    demandZones: {
      type: 'FeatureCollection',
      features: draft.zones.map((zone) => ({ type: 'Feature', properties: { label: zone.label, rationale: zone.rationale, priority: zone.priority }, geometry: { type: 'Polygon', coordinates: [[...zone.polygon, zone.polygon[0]!]] } })),
    } as FeatureCollection<Polygon, DraftZoneProperties>,
    candidates: {
      type: 'FeatureCollection',
      features: draft.candidates.map((candidate) => ({ type: 'Feature', properties: { id: candidate.id, label: candidate.label, note: candidate.note }, geometry: { type: 'Point', coordinates: candidate.coordinates } })),
    } as FeatureCollection<Point, DraftCandidateProperties>,
    riskCorridor: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { label: 'AI-assisted review corridor' }, geometry: { type: 'LineString', coordinates: draft.riskCorridor } }],
    } as FeatureCollection<LineString, { label: string }>,
  }
}
