export type ScenarioId = 'baseline' | 'growth' | 'monsoon'

export type PlanningTemplateId = 'hospital' | 'school' | 'market' | 'transit' | 'road' | 'public-space' | 'custom'
export type PlanningMode = 'site-selection' | 'corridor-selection' | 'network-and-site' | 'area-selection'
export type TemplateAvailability = 'active' | 'next' | 'brief-only'

export type PlanningTemplateDefinition = {
  id: PlanningTemplateId
  label: string
  mode: PlanningMode
  availability: TemplateAvailability
  note: string
  requiredData: string[]
}

export type PlanningIntent = {
  templateId: PlanningTemplateId
  mode: PlanningMode
  goal: string
  availability: TemplateAvailability
}

export type Scenario = {
  id: ScenarioId
  label: string
  note: string
}

export type LandPreference = 'municipal' | 'acquisition-allowed'

export type FacilityProfile = {
  type: 'hospital'
  beds: number
  minimumLandArea: number
  targetResponseTime: number
  budgetLakhs: number
  landPreference: LandPreference
}

export type SchoolFacilityProfile = {
  type: 'school'
  classrooms: number
  minimumLandArea: number
  targetWalkTime: number
  budgetLakhs: number
  landPreference: LandPreference
}

export type PlanningConditions = {
  populationGrowthPercent: number
  riverRisk: 'normal' | 'expanded'
  roadDisruption: 'none' | 'north-east-corridor' | 'south-bypass'
}

export type ScoreWeights = {
  travel: number
  need: number
  growth: number
  cost: number
  resilience: number
}

export type PlanningRequest = {
  facilityType: 'hospital'
  facilityProfile: FacilityProfile
  conditions: PlanningConditions
  weights: ScoreWeights
}

export type SchoolPlanningRequest = {
  facilityType: 'school'
  facilityProfile: SchoolFacilityProfile
  conditions: PlanningConditions
  weights: ScoreWeights
}

export type FloodRisk = 'low' | 'medium' | 'high'

export type SchoolCandidateMetrics = {
  access: number
  need: number
  growth: number
  served: string
  walkTime: string
  tradeoff: string
}

export type Candidate = {
  id: 'A' | 'B' | 'C'
  name: string
  location: string
  coordinates: [number, number]
  ownership: 'municipal' | 'private'
  siteAreaAcres: number
  acquisitionCostLakhs: number
  landUseAllowed: boolean
  roadAccessScore: number
  floodRisk: FloodRisk
  serviceCorridor: 'north-east' | 'civic-core' | 'south'
  travel: number
  need: number
  growth: number
  cost: number
  resilience: number
  served: string
  response: string
  tradeoff: string
  school?: SchoolCandidateMetrics
}

export type ScoredCandidate = Candidate & {
  score: number | null
  excluded: boolean
  exclusionReasons: string[]
  acquisitionRequired: boolean
}

export type RecommendationEngineState = 'ready' | 'no-viable-option' | 'needs-data' | 'needs-specialist-engine'

export type SiteSelectionRecommendation = {
  templateId: PlanningTemplateId
  mode: 'site-selection'
  state: RecommendationEngineState
  rankedCandidates: ScoredCandidate[]
  winner?: ScoredCandidate
}

export type Ward = {
  name: string
  density: number
  population: number
  populationGrowth: number
  emergencyDemand: number
  existingHospitalCoverage: number
  schoolAgeDemand?: number
  existingSchoolCoverage?: number
  coordinates: [number, number][]
}

export type DatasetLayer = 'wards' | 'roads' | 'facilities' | 'candidateSites' | 'riskZones'
export type DataReliability = 'verified' | 'estimated' | 'missing'

export type LayerProvenance = {
  source: string
  asOf?: string
  status: 'not-provided' | 'declared'
  reliability?: DataReliability
}

export type CityDataset = {
  id: string
  name: string
  scale: string
  dataStatus: 'synthetic' | 'imported'
  candidates: Candidate[]
  wards: Ward[]
  roads: [number, number][][]
  river: [number, number][]
  hospitals: Array<{ name: string; coordinates: [number, number] }>
  schools?: Array<{ name: string; coordinates: [number, number] }>
  provenance?: Partial<Record<DatasetLayer, LayerProvenance>>
}
