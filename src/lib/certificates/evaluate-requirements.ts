import type { Flight } from '@/lib/flightlog/types'
import { CERTIFICATE_REQUIREMENTS } from './requirements'
import type { CertificateChecklist, CertificateLevel, EvaluatedRequirement } from './types'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export function evaluateRequirements(
  level: CertificateLevel,
  flights: Flight[],
  currentLevel: CertificateLevel | null,
  levelSetAt: string | null,
  checklist: CertificateChecklist,
): EvaluatedRequirement[] {
  const checked = checklist[level] ?? {}

  return CERTIFICATE_REQUIREMENTS[level].map((requirement) => {
    if (requirement.kind === 'experience') {
      const current = requirement.compute(flights)
      return {
        kind: 'experience',
        id: requirement.id,
        label: requirement.label,
        unit: requirement.unit,
        current,
        threshold: requirement.threshold,
        satisfied: current >= requirement.threshold,
        caveat: requirement.caveat,
      }
    }

    if (requirement.kind === 'tenure') {
      // Only meaningful when the pilot's CURRENT level is the one this gate is measuring time
      // since — there is no recorded history of when an earlier level was held, so evaluating
      // this against any other current level reports "not yet started", not "satisfied".
      const daysHeld =
        currentLevel === requirement.sinceLevel && levelSetAt !== null
          ? Math.floor((Date.now() - new Date(levelSetAt).getTime()) / MILLISECONDS_PER_DAY)
          : null
      return {
        kind: 'tenure',
        id: requirement.id,
        label: requirement.label,
        daysHeld,
        minDays: requirement.minDays,
        satisfied: daysHeld !== null && daysHeld >= requirement.minDays,
      }
    }

    return {
      kind: 'manual',
      id: requirement.id,
      label: requirement.label,
      checked: checked[requirement.id] ?? false,
    }
  })
}
