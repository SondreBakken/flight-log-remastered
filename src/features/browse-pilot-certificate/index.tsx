import { evaluateRequirements } from '@/lib/certificates/evaluate-requirements'
import { CERTIFICATE_LEVELS, nextLevel, type CertificateChecklist as CertificateChecklistState, type CertificateLevel } from '@/lib/certificates/types'
import type { Flight } from '@/lib/flightlog/types'
import { CertificateLevelForm } from './certificate-level-form'
import { CertificateChecklist as CertificateChecklistCard } from './certificate-checklist'

type PilotCertificateProgressProps = {
  flights: Flight[]
  isOwner: boolean
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklistState
}

// No level declared and the viewer isn't the owner: there's nothing to show — the spec's own
// call, not an oversight (docs/superpowers/specs/2026-08-27-certificate-progress-design.md's UI
// section).
export default function PilotCertificateProgress({ flights, isOwner, level, levelSetAt, checklist }: PilotCertificateProgressProps) {
  if (level === null && !isOwner) return null

  const upcoming = level === null ? null : nextLevel(level)

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Certificate progress</h2>
      {isOwner && <CertificateLevelForm currentLevel={level} />}
      {upcoming !== null && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium opacity-70">Progress toward {upcoming}</h3>
          <CertificateChecklistCard
            isOwner={isOwner}
            items={evaluateRequirements(upcoming, flights, level, levelSetAt, checklist)}
            level={upcoming}
          />
        </div>
      )}
      {level !== null && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-medium opacity-70">View full requirements</summary>
          <div className="flex flex-col gap-4 pt-2">
            {CERTIFICATE_LEVELS.filter((tableLevel) => tableLevel !== upcoming).map((tableLevel) => (
              <div className="flex flex-col gap-2" key={tableLevel}>
                <h4 className="text-sm font-medium opacity-70">{tableLevel}</h4>
                <CertificateChecklistCard
                  isOwner={isOwner}
                  items={evaluateRequirements(tableLevel, flights, level, levelSetAt, checklist)}
                  level={tableLevel}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
