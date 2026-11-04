import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

export type CertificateProgressRow = {
  userId: string
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

// Reverse lookup: profiles are keyed by user id, the pilot page by flightlog.org pilot id. Public
// read, so it answers any viewer, signed in or not. flightlog_pilot_id is not unique (the link is
// self-declared), so more than one profile can claim a pilot id; this reads the first match.
export async function getCertificateProgressByPilotId(db: Database, pilotId: PilotId): Promise<CertificateProgressRow | null> {
  const [row] = await findCertificateProgress(db, pilotId).catch((error: unknown) => {
    console.error('[profiles] failed to load certificate progress for pilot id:', error)
    throw new ProfilesQueryError(`Failed to load certificate progress for pilot id ${pilotId}`, { cause: error })
  })
  if (row === undefined) return null

  return {
    userId: row.userId,
    level: row.level as CertificateLevel | null,
    levelSetAt: row.levelSetAt?.toISOString() ?? null,
    checklist: row.checklist as CertificateChecklist,
  }
}

function findCertificateProgress(db: Database, pilotId: PilotId) {
  return db
    .select({
      userId: profiles.userId,
      level: profiles.certificateLevel,
      levelSetAt: profiles.certificateLevelSetAt,
      checklist: profiles.certificateChecklist,
    })
    .from(profiles)
    .where(eq(profiles.flightlogPilotId, pilotId))
    .limit(1)
}
