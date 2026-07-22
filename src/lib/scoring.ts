import { planningRequests } from '../data/city'
import type { Candidate, PlanningRequest, ScoredCandidate } from '../types'

const floodPenalty = { low: 0, medium: 10, high: 28 }
const accessPenalty = { low: 0, medium: 4, high: 12 }

export function scoreCandidate(candidate: Candidate, request: PlanningRequest = planningRequests.baseline): ScoredCandidate {
  const metrics = { ...candidate }
  const exclusionReasons: string[] = []
  const acquisitionRequired = candidate.ownership === 'private'
  const { facilityProfile: profile, conditions, weights } = request
  const capacityLandRequirement = Math.ceil(profile.beds / 20)
  const requiredLandArea = Math.max(profile.minimumLandArea, capacityLandRequirement)
  const responseMinutes = Number.parseFloat(candidate.response)

  if (!candidate.landUseAllowed) exclusionReasons.push('Land use is not permitted for a hospital.')
  if (candidate.siteAreaAcres < requiredLandArea) exclusionReasons.push(`Site area is below the ${requiredLandArea}-acre requirement for this ${profile.beds}-bed hospital.`)
  if (profile.landPreference === 'municipal' && acquisitionRequired) exclusionReasons.push('The request requires municipal land, but this parcel is privately owned.')

  if (acquisitionRequired) {
    if (candidate.acquisitionCostLakhs > profile.budgetLakhs) exclusionReasons.push(`Estimated land acquisition of ₹${candidate.acquisitionCostLakhs} lakh exceeds the ₹${profile.budgetLakhs} lakh budget.`)
    const acquisitionPenalty = Math.min(35, Math.round((candidate.acquisitionCostLakhs / profile.budgetLakhs) * 100))
    metrics.cost = Math.max(0, metrics.cost - acquisitionPenalty)
  }

  if (responseMinutes > profile.targetResponseTime) {
    metrics.travel -= Math.round((responseMinutes - profile.targetResponseTime) * 5)
  }

  if (conditions.populationGrowthPercent > 0) {
    metrics.growth += Math.round(candidate.growth * (conditions.populationGrowthPercent / 285))
    metrics.need += Math.round(candidate.need * (conditions.populationGrowthPercent / 400))
    metrics.travel += Math.round(candidate.roadAccessScore * (conditions.populationGrowthPercent / 1000))
  }

  if (conditions.riverRisk === 'expanded') {
    metrics.resilience -= floodPenalty[candidate.floodRisk]
    metrics.travel -= accessPenalty[candidate.floodRisk]
    if (candidate.floodRisk === 'high') exclusionReasons.push('The expanded river buffer makes this site unsafe during monsoon conditions.')
  }

  if (conditions.roadDisruption !== 'none') {
    const disruptedCorridor = conditions.roadDisruption === 'north-east-corridor' ? 'north-east' : 'south'
    if (candidate.serviceCorridor === disruptedCorridor) metrics.travel -= 16
  }

  const score = Math.round(
    metrics.travel * weights.travel + metrics.need * weights.need + metrics.growth * weights.growth + metrics.cost * weights.cost + metrics.resilience * weights.resilience,
  )

  const excluded = exclusionReasons.length > 0
  return { ...metrics, score: excluded ? null : score, excluded, exclusionReasons, acquisitionRequired }
}

export function rankCandidates(candidates: Candidate[], request: PlanningRequest = planningRequests.baseline) {
  return candidates
    .map((candidate) => scoreCandidate(candidate, request))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
}
