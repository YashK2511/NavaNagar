import type { Candidate, CityDataset, SchoolPlanningRequest, ScoredCandidate, SiteSelectionRecommendation } from '../types'

const floodPenalty = { low: 0, medium: 8, high: 26 }

function scoreSchoolCandidate(candidate: Candidate, request: SchoolPlanningRequest): ScoredCandidate {
  const exclusionReasons: string[] = []
  const acquisitionRequired = candidate.ownership === 'private'
  const school = candidate.school
  if (!school) return { ...candidate, score: null, excluded: true, exclusionReasons: ['School-demand and safe-access metrics are missing for this parcel.'], acquisitionRequired }

  const metrics = { ...candidate, travel: school.access, need: school.need, growth: school.growth, served: school.served, response: school.walkTime, tradeoff: school.tradeoff }
  const { facilityProfile: profile, conditions, weights } = request
  const requiredLandArea = Math.max(profile.minimumLandArea, Math.ceil(profile.classrooms / 8))
  const walkMinutes = Number.parseFloat(school.walkTime)

  if (!candidate.landUseAllowed) exclusionReasons.push('Land use is not permitted for a school.')
  if (candidate.siteAreaAcres < requiredLandArea) exclusionReasons.push(`Site area is below the ${requiredLandArea}-acre requirement for ${profile.classrooms} classrooms.`)
  if (profile.landPreference === 'municipal' && acquisitionRequired) exclusionReasons.push('The request requires municipal land, but this parcel is privately owned.')
  if (acquisitionRequired && candidate.acquisitionCostLakhs > profile.budgetLakhs) exclusionReasons.push(`Estimated land acquisition of ₹${candidate.acquisitionCostLakhs} lakh exceeds the ₹${profile.budgetLakhs} lakh budget.`)

  if (acquisitionRequired) metrics.cost = Math.max(0, metrics.cost - Math.min(35, Math.round((candidate.acquisitionCostLakhs / profile.budgetLakhs) * 100)))
  if (walkMinutes > profile.targetWalkTime) metrics.travel -= Math.round((walkMinutes - profile.targetWalkTime) * 5)
  if (conditions.populationGrowthPercent > 0) { metrics.growth += Math.round(school.growth * (conditions.populationGrowthPercent / 260)); metrics.need += Math.round(school.need * (conditions.populationGrowthPercent / 420)) }
  if (conditions.riverRisk === 'expanded') { metrics.resilience -= floodPenalty[candidate.floodRisk]; if (candidate.floodRisk === 'high') exclusionReasons.push('The expanded river buffer makes this school site unsafe during monsoon conditions.') }
  if (conditions.roadDisruption !== 'none') { const corridor = conditions.roadDisruption === 'north-east-corridor' ? 'north-east' : 'south'; if (candidate.serviceCorridor === corridor) metrics.travel -= 14 }

  const score = Math.round(metrics.travel * weights.travel + metrics.need * weights.need + metrics.growth * weights.growth + metrics.cost * weights.cost + metrics.resilience * weights.resilience)
  const excluded = exclusionReasons.length > 0
  return { ...metrics, score: excluded ? null : score, excluded, exclusionReasons, acquisitionRequired }
}

export function analyseSchoolSiteSelection(city: CityDataset, request: SchoolPlanningRequest): SiteSelectionRecommendation {
  if (!city.candidates.some((candidate) => candidate.school) || !city.wards.some((ward) => ward.schoolAgeDemand !== undefined && ward.existingSchoolCoverage !== undefined)) return { templateId: 'school', mode: 'site-selection', state: 'needs-data', rankedCandidates: [] }
  const rankedCandidates = city.candidates.map((candidate) => scoreSchoolCandidate(candidate, request)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const winner = rankedCandidates.find((candidate) => !candidate.excluded)
  return { templateId: 'school', mode: 'site-selection', state: winner ? 'ready' : 'no-viable-option', rankedCandidates, winner }
}
