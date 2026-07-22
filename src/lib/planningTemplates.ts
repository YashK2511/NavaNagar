import type { PlanningTemplateDefinition } from '../types'

export const ACTIVE_PLANNING_TEMPLATE_ID = 'hospital' as const

export const planningTemplates: PlanningTemplateDefinition[] = [
  { id: 'hospital', label: 'Hospital', mode: 'site-selection', availability: 'active', note: 'Emergency access, care gaps, land, and resilience.', requiredData: ['Emergency demand', 'Existing care coverage', 'Road access', 'Parcel land, cost, and flood-risk data'] },
  { id: 'school', label: 'School', mode: 'site-selection', availability: 'active', note: 'Student demand, safe access, coverage, and land.', requiredData: ['Student-age demand', 'Existing school coverage', 'Safe walking network', 'Eligible parcel and land-use data'] },
  { id: 'market', label: 'Market / shop', mode: 'site-selection', availability: 'brief-only', note: 'Commercial demand, zoning, and footfall data required.', requiredData: ['Commercial zoning', 'Footfall or trip-demand data', 'Parking and loading access', 'Candidate parcel availability'] },
  { id: 'transit', label: 'Transit station', mode: 'network-and-site', availability: 'brief-only', note: 'Rail or bus network, transfer, and demand data required.', requiredData: ['Transit alignment', 'Passenger demand and transfer points', 'Walking and feeder access', 'Land and interchange constraints'] },
  { id: 'road', label: 'Road / corridor', mode: 'corridor-selection', availability: 'brief-only', note: 'Requires a routable road network and origin–destination demand.', requiredData: ['Routable road network', 'Traffic or origin–destination demand', 'Right-of-way and utility constraints', 'Flood and closure layers'] },
  { id: 'public-space', label: 'Public space', mode: 'area-selection', availability: 'brief-only', note: 'Open-space, land-use, heat, and flood data required.', requiredData: ['Open-space inventory', 'Land use and ownership', 'Heat / flood / canopy layers', 'Population access gaps'] },
  { id: 'custom', label: 'Custom proposal', mode: 'site-selection', availability: 'brief-only', note: 'Define a goal, evidence layers, and specialist rules first.', requiredData: ['Clear objective', 'Relevant demand layer', 'Eligible geometry', 'Cost, risk, and regulatory constraints'] },
]

export function getPlanningTemplate(templateId: PlanningTemplateDefinition['id']) {
  return planningTemplates.find((template) => template.id === templateId)
}
