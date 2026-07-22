import { rankCandidates } from './scoring'
import type { CityDataset, PlanningRequest, SiteSelectionRecommendation } from '../types'

// Hospital is the first specialised template. Future site-selection templates
// (School, Market, Transit) will return the same recommendation contract.
export function analyseHospitalSiteSelection(city: CityDataset, request: PlanningRequest): SiteSelectionRecommendation {
  const rankedCandidates = rankCandidates(city.candidates, request)
  const winner = rankedCandidates.find((candidate) => !candidate.excluded)
  return {
    templateId: 'hospital',
    mode: 'site-selection',
    state: winner ? 'ready' : 'no-viable-option',
    rankedCandidates,
    winner,
  }
}
