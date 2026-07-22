import type { PlanningRequest } from '../types'

export type InterpretationResult = {
  request: PlanningRequest
  recognized: string[]
  defaultsKept: string[]
}

function cloneRequest(request: PlanningRequest): PlanningRequest {
  return {
    ...request,
    facilityProfile: { ...request.facilityProfile },
    conditions: { ...request.conditions },
    weights: { ...request.weights },
  }
}

export function interpretHospitalRequest(text: string, currentRequest: PlanningRequest): InterpretationResult {
  const request = cloneRequest(currentRequest)
  const normalized = text.toLowerCase()
  const recognized: string[] = []
  const defaultsKept: string[] = []

  if (/\b(hospital|emergency hospital|emergency care)\b/.test(normalized)) {
    recognized.push('Facility: emergency hospital')
  } else {
    defaultsKept.push('Facility type was not explicit; keeping emergency hospital.')
  }

  const beds = normalized.match(/\b(\d{1,3})\s*(?:-?\s*bed|beds)\b/)
  if (beds) {
    request.facilityProfile.beds = Number(beds[1])
    recognized.push(`Capacity: ${beds[1]} beds`)
  } else {
    defaultsKept.push(`Capacity not specified; keeping ${request.facilityProfile.beds} beds.`)
  }

  const acres = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:acre|acres)\b/)
  if (acres) {
    request.facilityProfile.minimumLandArea = Number(acres[1])
    recognized.push(`Minimum land: ${acres[1]} acres`)
  } else {
    defaultsKept.push(`Minimum land not specified; keeping ${request.facilityProfile.minimumLandArea} acres.`)
  }

  const response = normalized.match(/\b(\d{1,2})\s*(?:minute|minutes|min)\b/)
  if (response) {
    request.facilityProfile.targetResponseTime = Number(response[1])
    recognized.push(`Response target: ${response[1]} minutes`)
  } else {
    defaultsKept.push(`Response target not specified; keeping ${request.facilityProfile.targetResponseTime} minutes.`)
  }

  const budget = normalized.match(/(?:budget(?:\s+(?:of|is))?|₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lakhs|lac|lacs)?/)
  if (budget) {
    const amount = Number(budget[1])
    const unit = budget[2]
    const budgetLakhs = unit === 'crore' || unit === 'cr' ? amount * 100 : amount
    request.facilityProfile.budgetLakhs = budgetLakhs
    recognized.push(`Budget: ₹${budgetLakhs} lakh`)
  } else {
    defaultsKept.push(`Budget not specified; keeping ₹${request.facilityProfile.budgetLakhs} lakh.`)
  }

  if (/municipal\s+(?:land\s+)?only|government\s+(?:land\s+)?only|public\s+(?:land\s+)?only/.test(normalized)) {
    request.facilityProfile.landPreference = 'municipal'
    recognized.push('Land policy: municipal land only')
  } else if (/acquisition|private\s+land|buy\s+land/.test(normalized)) {
    request.facilityProfile.landPreference = 'acquisition-allowed'
    recognized.push('Land policy: acquisition allowed')
  } else {
    defaultsKept.push('Land policy not specified; keeping municipal preferred with acquisition allowed.')
  }

  const growth = normalized.match(/\b(\d{1,2})\s*%\s*(?:population\s*)?growth\b/)
  if (growth) {
    request.conditions.populationGrowthPercent = Number(growth[1])
    recognized.push(`Population growth: ${growth[1]}%`)
  }

  if (/monsoon|flood|river\s+(?:buffer|risk)/.test(normalized)) {
    request.conditions.riverRisk = 'expanded'
    recognized.push('River condition: expanded monsoon buffer')
  }

  if (/north[ -]?east.*(?:road\s*)?(?:closure|disruption)|north[ -]?east corridor/.test(normalized)) {
    request.conditions.roadDisruption = 'north-east-corridor'
    recognized.push('Road condition: north-east corridor disruption')
  } else if (/south.*(?:bypass|road).*(?:closure|disruption)|south bypass/.test(normalized)) {
    request.conditions.roadDisruption = 'south-bypass'
    recognized.push('Road condition: south bypass disruption')
  }

  return { request, recognized, defaultsKept }
}
