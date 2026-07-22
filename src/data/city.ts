import type { Candidate, CityDataset, FacilityProfile, PlanningRequest, ScenarioId, SchoolFacilityProfile, SchoolPlanningRequest, Ward } from '../types'

// Synthetic geometry and planning attributes for NavaNagar. Replace this module
// to demonstrate the same planner with another city's data.
export const candidates: Candidate[] = [
  {
    id: 'A', name: 'Yeola Gateway Parcel', location: 'Railway–MIDC approach', coordinates: [0.041, 0.055],
    ownership: 'municipal', siteAreaAcres: 5.4, acquisitionCostLakhs: 0, landUseAllowed: true, roadAccessScore: 92, floodRisk: 'medium', serviceCorridor: 'north-east',
    travel: 91, need: 87, growth: 93, cost: 69, resilience: 84, served: '31,800 residents', response: '8.4 min average', tradeoff: 'Municipal land with strong north-east coverage; drainage review is still required.',
    school: { access: 90, need: 88, growth: 94, served: '6,800 students', walkTime: '9.2 min walk', tradeoff: 'Strong north-east student catchment and municipal land; a protected crossing is needed at the rail approach.' },
  },
  {
    id: 'B', name: 'Civic Core Parcel', location: 'Bus stand district', coordinates: [-0.028, 0.003],
    ownership: 'municipal', siteAreaAcres: 4.3, acquisitionCostLakhs: 0, landUseAllowed: true, roadAccessScore: 96, floodRisk: 'low', serviceCorridor: 'civic-core',
    travel: 94, need: 44, growth: 49, cost: 91, resilience: 95, served: '22,400 residents', response: '7.8 min average', tradeoff: 'Fastest access, but it duplicates existing hospital coverage in the civic core.',
    school: { access: 95, need: 43, growth: 48, served: '3,100 students', walkTime: '6.4 min walk', tradeoff: 'Safest access and lowest risk, but it overlaps established school coverage in the civic core.' },
  },
  {
    id: 'C', name: 'South Link Parcel', location: 'Industrial bypass edge', coordinates: [0.033, -0.055],
    ownership: 'private', siteAreaAcres: 5.8, acquisitionCostLakhs: 145, landUseAllowed: true, roadAccessScore: 76, floodRisk: 'high', serviceCorridor: 'south',
    travel: 77, need: 85, growth: 76, cost: 79, resilience: 57, served: '26,100 residents', response: '10.9 min average', tradeoff: 'Serves an underserved edge, but requires land acquisition and has high river exposure.',
    school: { access: 72, need: 82, growth: 78, served: '5,400 students', walkTime: '12.1 min walk', tradeoff: 'Would serve an underserved southern catchment, but acquisition and monsoon safety are significant concerns.' },
  },
]

const wardSeeds: Array<[number, number, number, string, number, number, number, number]> = [
  [-0.06, 0.04, 65, 'Ward 01', 9800, 6, 58, 72], [-0.02, 0.04, 88, 'Ward 02', 14200, 12, 81, 43], [0.02, 0.04, 93, 'Ward 03', 15100, 15, 88, 39],
  [-0.06, 0.0, 59, 'Ward 04', 8700, 4, 48, 75], [-0.02, 0.0, 76, 'Ward 05', 11800, 7, 69, 38], [0.02, 0.0, 82, 'Ward 06', 12600, 9, 72, 49],
  [-0.06, -0.04, 48, 'Ward 07', 6900, 3, 52, 68], [-0.02, -0.04, 72, 'Ward 08', 10800, 6, 77, 47], [0.02, -0.04, 67, 'Ward 09', 9900, 5, 74, 45],
  [0.06, 0.04, 81, 'Ward 10', 12300, 11, 76, 51], [0.06, 0.0, 74, 'Ward 11', 11100, 8, 66, 58], [0.06, -0.04, 53, 'Ward 12', 7600, 4, 70, 41],
]

export const wards: Ward[] = wardSeeds.map(([x, y, density, name, population, populationGrowth, emergencyDemand, existingHospitalCoverage]) => ({
  name,
  density,
  population,
  populationGrowth,
  emergencyDemand,
  existingHospitalCoverage,
  schoolAgeDemand: Math.min(96, Math.round(emergencyDemand * .72 + populationGrowth * 2)),
  existingSchoolCoverage: Math.max(28, Math.min(86, Math.round(existingHospitalCoverage * .82 + (populationGrowth < 6 ? 9 : -3)))),
  coordinates: [
    [x - 0.018, y - 0.016], [x + 0.018, y - 0.016], [x + 0.018, y + 0.016],
    [x - 0.018, y + 0.016], [x - 0.018, y - 0.016],
  ] as [number, number][],
}))

// Phase 2 default. A future planning-request form will let users edit this profile.
export const defaultHospitalProfile: FacilityProfile = {
  type: 'hospital',
  beds: 50,
  minimumLandArea: 4,
  targetResponseTime: 10,
  budgetLakhs: 900,
  landPreference: 'acquisition-allowed',
}

export const defaultSchoolProfile: SchoolFacilityProfile = {
  type: 'school',
  classrooms: 24,
  minimumLandArea: 3,
  targetWalkTime: 10,
  budgetLakhs: 700,
  landPreference: 'acquisition-allowed',
}

const standardWeights = {
  travel: 0.4,
  need: 0.25,
  growth: 0.15,
  cost: 0.1,
  resilience: 0.1,
}

export const planningRequests: Record<ScenarioId, PlanningRequest> = {
  baseline: {
    facilityType: 'hospital',
    facilityProfile: defaultHospitalProfile,
    conditions: { populationGrowthPercent: 0, riverRisk: 'normal', roadDisruption: 'none' },
    weights: standardWeights,
  },
  growth: {
    facilityType: 'hospital',
    facilityProfile: defaultHospitalProfile,
    conditions: { populationGrowthPercent: 20, riverRisk: 'normal', roadDisruption: 'none' },
    weights: standardWeights,
  },
  monsoon: {
    facilityType: 'hospital',
    facilityProfile: defaultHospitalProfile,
    conditions: { populationGrowthPercent: 0, riverRisk: 'expanded', roadDisruption: 'none' },
    weights: standardWeights,
  },
}

export const schoolPlanningRequests: Record<ScenarioId, SchoolPlanningRequest> = {
  baseline: { facilityType: 'school', facilityProfile: defaultSchoolProfile, conditions: { populationGrowthPercent: 0, riverRisk: 'normal', roadDisruption: 'none' }, weights: { travel: .3, need: .3, growth: .15, cost: .1, resilience: .15 } },
  growth: { facilityType: 'school', facilityProfile: defaultSchoolProfile, conditions: { populationGrowthPercent: 20, riverRisk: 'normal', roadDisruption: 'none' }, weights: { travel: .3, need: .3, growth: .15, cost: .1, resilience: .15 } },
  monsoon: { facilityType: 'school', facilityProfile: defaultSchoolProfile, conditions: { populationGrowthPercent: 0, riverRisk: 'expanded', roadDisruption: 'none' }, weights: { travel: .3, need: .3, growth: .15, cost: .1, resilience: .15 } },
}

export const roads: [number, number][][] = [
  [[-0.085, 0.01], [-0.04, 0.015], [0.0, 0.011], [0.075, 0.02]],
  [[-0.03, 0.08], [-0.02, 0.02], [-0.012, -0.07]],
  [[0.048, 0.084], [0.03, 0.04], [0.0, 0.011], [-0.05, -0.045]],
  [[-0.08, -0.045], [-0.02, -0.04], [0.04, -0.055], [0.083, -0.05]],
]

export const river: [number, number][] = [[-0.095, -0.065], [-0.04, -0.055], [0.0, -0.072], [0.045, -0.058], [0.095, -0.074], [0.095, -0.095], [-0.095, -0.095], [-0.095, -0.065]]

export const hospitals = [[-0.024, 0.017], [-0.014, 0.006], [-0.004, 0.02], [-0.03, -0.01], [-0.008, -0.015]].map((coordinates, index) => ({
  name: `Care centre ${index + 1}`,
  coordinates: coordinates as [number, number],
}))

export const schools = [[0.005, 0.045], [0.052, 0.032], [-0.052, -0.022], [0.018, -0.038]].map((coordinates, index) => ({
  name: `School ${index + 1}`,
  coordinates: coordinates as [number, number],
}))

export const navaNagar: CityDataset = { id: 'navanagar', name: 'NavaNagar', scale: '1 : 24,000', dataStatus: 'synthetic', candidates, wards, roads, river, hospitals, schools }

const suryaCoordinate = ([x, y]: [number, number]): [number, number] => [
  Number((-x * .82 + y * .42 + .01).toFixed(3)),
  Number((y * .72 + x * .18 + .006).toFixed(3)),
]

export const suryaNagar: CityDataset = {
  ...navaNagar,
  id: 'suryanagar',
  name: 'SuryaNagar',
  scale: '1 : 21,000',
  candidates: candidates.map((candidate) => ({
    ...candidate,
    coordinates: suryaCoordinate(candidate.coordinates),
    name: candidate.id === 'A' ? 'East Market Reserve' : candidate.id === 'B' ? 'Civic Ring Parcel' : 'Canal Link Parcel',
    location: candidate.id === 'A' ? 'Market–ring-road approach' : candidate.id === 'B' ? 'Old civic district' : 'Southern canal edge',
    tradeoff: candidate.id === 'A' ? 'Municipal land with strong east-side coverage; junction design needs review.' : candidate.id === 'B' ? 'Fastest access, but overlaps established civic-core coverage.' : 'Serves a growing edge, but requires acquisition and has canal exposure.',
  })),
  wards: wards.map((ward) => ({ ...ward, coordinates: ward.coordinates.map(suryaCoordinate) })),
  roads: roads.map((road) => road.map(suryaCoordinate)),
  river: river.map(suryaCoordinate),
  hospitals: hospitals.map((hospital, index) => ({ ...hospital, name: `Care point ${index + 1}`, coordinates: suryaCoordinate(hospital.coordinates) })),
  schools: schools.map((school, index) => ({ ...school, name: `Learning centre ${index + 1}`, coordinates: suryaCoordinate(school.coordinates) })),
}

export const builtInCities = [navaNagar, suryaNagar]
