import type { Flight } from '@/lib/flightlog/types'

export const CERTIFICATE_LEVELS = ['PP2', 'PP3', 'PP4', 'PP5'] as const
export type CertificateLevel = (typeof CERTIFICATE_LEVELS)[number]

export function nextLevel(level: CertificateLevel): CertificateLevel | null {
  const index = CERTIFICATE_LEVELS.indexOf(level)
  return CERTIFICATE_LEVELS[index + 1] ?? null
}

// Self-check state for a pilot, keyed by level then requirement id — e.g.
// `{ PP4: { 'safety-course': true } }`. A level or requirement id with no entry is simply
// unchecked; callers never need to distinguish "explicitly false" from "absent".
export type CertificateChecklist = Partial<Record<CertificateLevel, Record<string, boolean>>>

type RequirementBase = {
  id: string
  label: string
}

// Auto-computed from the pilot's Flight[] — e.g. total hours, flights over a duration threshold.
export type ExperienceRequirement = RequirementBase & {
  kind: 'experience'
  unit: string
  threshold: number
  compute: (flights: Flight[]) => number
  // Shown as a persistent footnote next to this item wherever it's rendered — e.g. the
  // flightCount > 1 aggregation caveat on a duration-threshold item, or the XC-count
  // approximation note. Absent when the computed number needs no caveat.
  caveat?: string
}

// Auto-computed from how long the pilot has held their currently-declared level — e.g. PP4's
// "held PP3 for at least 12 months". Only ever satisfiable when the pilot's CURRENT level is
// `sinceLevel`; evaluated against a different current level reports as not-yet-started rather
// than satisfied, since there is no recorded history of when an earlier level was held.
export type TenureRequirement = RequirementBase & {
  kind: 'tenure'
  sinceLevel: CertificateLevel
  minDays: number
}

// Self-check only — nothing in the flight data can verify this (a skill, a theory exam, a
// lift-source qualifier).
export type ManualRequirement = RequirementBase & {
  kind: 'manual'
}

export type RequirementDefinition = ExperienceRequirement | TenureRequirement | ManualRequirement

export type ExperienceEvaluation = RequirementBase & {
  kind: 'experience'
  unit: string
  current: number
  threshold: number
  satisfied: boolean
  caveat?: string
}

export type TenureEvaluation = RequirementBase & {
  kind: 'tenure'
  daysHeld: number | null
  minDays: number
  satisfied: boolean
}

export type ManualEvaluation = RequirementBase & {
  kind: 'manual'
  checked: boolean
}

export type EvaluatedRequirement = ExperienceEvaluation | TenureEvaluation | ManualEvaluation
