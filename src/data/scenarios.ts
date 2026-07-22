import type { Scenario } from '../types'

export const scenarios: Scenario[] = [
  { id: 'baseline', label: 'Baseline', note: 'Existing demand and access patterns' },
  { id: 'growth', label: '+20% north-east growth', note: 'New homes add demand along the rail corridor' },
  { id: 'monsoon', label: 'Monsoon river buffer', note: 'Expanded river protection and reduced road resilience' },
]
