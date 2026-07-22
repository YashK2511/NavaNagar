import { getPlanningTemplate } from './planningTemplates'
import type { PlanningMode, PlanningTemplateId, TemplateAvailability } from '../types'

type BriefTemplateId = Exclude<PlanningTemplateId, 'hospital' | 'school'>

export type PlanningBrief = {
  templateId: BriefTemplateId
  title: string
  mode: PlanningMode
  availability: Exclude<TemplateAvailability, 'active'>
  decisionQuestion: string
  engineBoundary: string
  requiredData: string[]
  nextStep: string
}

function brief(templateId: BriefTemplateId, title: string, decisionQuestion: string, engineBoundary: string, nextStep: string): PlanningBrief {
  const template = getPlanningTemplate(templateId)!
  return { templateId, title, mode: template.mode, availability: template.availability as PlanningBrief['availability'], decisionQuestion, engineBoundary, requiredData: template.requiredData, nextStep }
}

export function createPlanningBrief(text: string): PlanningBrief {
  const normalized = text.toLowerCase()
  if (/\b(shop|market|retail|commercial|vendor)\b/.test(normalized)) return brief('market', 'Market / shop planning brief', 'Which eligible location can serve unmet commercial demand while meeting zoning, loading, and access constraints?', 'Market demand depends on footfall, zoning, loading, and commercial viability; hospital or school parcel scores would be misleading.', 'Collect commercial-demand and zoning evidence before enabling a market-location engine.')
  if (/\b(train|rail|station|metro|bus station|transit)\b/.test(normalized)) return brief('transit', 'Transit station planning brief', 'Where should a station or interchange sit on the network to improve access and transfers for the greatest passenger demand?', 'Transit is a network-and-site decision. It needs routes, transfer patterns, and passenger flows before any location can be ranked.', 'Import the transit network and passenger-demand layers before evaluating station locations.')
  if (/\b(road|corridor|flyover|junction|street|highway|bypass)\b/.test(normalized)) return brief('road', 'Road / corridor planning brief', 'Which road corridor or junction intervention best improves movement, safety, and resilience for the stated travel demand?', 'Road decisions compare connected corridors, not isolated parcels. A routable network and origin–destination demand are essential.', 'Build a corridor-analysis engine using a routable road network; parcel scoring is not suitable for this decision.')
  if (/\b(park|garden|playground|public space|green space|open space)\b/.test(normalized)) return brief('public-space', 'Public-space planning brief', 'Which neighbourhood area has the greatest access gap for safe, climate-resilient public space?', 'Public-space planning is an area-access decision that needs open-space, environmental, and population-access layers.', 'Add open-space and environmental layers before identifying intervention areas.')
  return brief('custom', 'Custom planning brief', 'What specific spatial decision should be made, for whom, under which cost, risk, and regulatory constraints?', 'A custom proposal needs a defined decision mode and evidence model before it can be evaluated honestly.', 'Choose a specialist template or define the required data and rule set before producing a recommendation.')
}
