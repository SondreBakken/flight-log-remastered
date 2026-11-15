import { evaluateRequirements } from '@/lib/certificates/evaluate-requirements'
import { CERTIFICATE_LEVELS, nextLevel, type CertificateChecklist as CertificateChecklistState, type CertificateLevel } from '@/lib/certificates/types'
import type { Flight } from '@/lib/flightlog/types'
import { CertificateLevelForm } from './certificate-level-form'
import { CertificateChecklist as CertificateChecklistCard } from './certificate-checklist'

type CertificateLevelGroupProps = {
  headingId: string
  title: string
  headingLevel: 'h3' | 'h4'
  isEmphasized?: boolean
  children: React.ReactNode
}

function CertificateLevelGroup({ headingId, title, headingLevel: Heading, isEmphasized = false, children }: CertificateLevelGroupProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-md border border-rule p-4${isEmphasized ? ' bg-black/5 dark:bg-white/5' : ''}`}
    >
      <Heading className="text-base font-medium" id={headingId}>{title}</Heading>
      {children}
    </section>
  )
}

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
        <CertificateLevelGroup headingId="certificate-upcoming-heading" headingLevel="h3" isEmphasized title={`Progress toward ${upcoming}`}>
          <CertificateChecklistCard
            isOwner={isOwner}
            items={evaluateRequirements(upcoming, flights, level, levelSetAt, checklist)}
            level={upcoming}
          />
        </CertificateLevelGroup>
      )}
      {level !== null && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-medium opacity-70">View full requirements</summary>
          <div className="flex flex-col gap-4 pt-2">
            {CERTIFICATE_LEVELS.map((tableLevel) =>
              tableLevel === upcoming ? (
                <p className="rounded-md border border-dashed border-rule p-4 text-sm opacity-70" key={tableLevel}>{tableLevel}: shown above</p>
              ) : (
                <CertificateLevelGroup headingId={`certificate-level-${tableLevel}-heading`} headingLevel="h4" key={tableLevel} title={tableLevel}>
                  <CertificateChecklistCard
                    isOwner={isOwner}
                    items={evaluateRequirements(tableLevel, flights, level, levelSetAt, checklist)}
                    level={tableLevel}
                  />
                </CertificateLevelGroup>
              ),
            )}
          </div>
        </details>
      )}
    </section>
  )
}
