import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { profileVerifications } from '@/lib/db/schema'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

// Which of pilotIds the viewer holds a verified link to. viewerUserId must be the session's own
// id: verification rows are private to their owner, and with RLS gone the user_id filter is what
// keeps this from reporting every user's verified pilot ids. Whether a pilot is verified at all,
// by anyone, is the public isPilotVerified lookup.
export async function getVerifiedPilotIds(db: Database, viewerUserId: string, pilotIds: PilotId[]): Promise<Set<PilotId>> {
  if (pilotIds.length === 0) return new Set()

  const rows = await findVerifiedPilotIds(db, viewerUserId, pilotIds).catch((error: unknown) => {
    console.error('[profiles] failed to load pilot verification statuses:', error)
    throw new ProfilesQueryError(`Failed to load the verified pilot ids of user ${viewerUserId}`, { cause: error })
  })
  return new Set(rows.map((row) => row.flightlogPilotId))
}

function findVerifiedPilotIds(db: Database, viewerUserId: string, pilotIds: PilotId[]) {
  return db
    .select({ flightlogPilotId: profileVerifications.flightlogPilotId })
    .from(profileVerifications)
    .where(
      and(
        eq(profileVerifications.userId, viewerUserId),
        inArray(profileVerifications.flightlogPilotId, pilotIds),
        eq(profileVerifications.status, 'verified'),
      ),
    )
}
