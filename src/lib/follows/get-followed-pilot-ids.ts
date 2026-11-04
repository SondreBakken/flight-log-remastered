import { and, eq, inArray } from 'drizzle-orm'
import { follows } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

// candidatePilotIds narrows the read to the pilots a page renders. Omitted entirely, it returns
// every pilot the user follows, which is what the flight feed needs; an empty array is a
// different case ("nothing to check") and short-circuits without a query.
//
// A query error throws a FollowsQueryError rather than returning an empty Set (#155), so a broken
// read is never mistaken for "follows nobody".
export async function getFollowedPilotIds(
  db: Database,
  userId: string,
  candidatePilotIds?: PilotId[],
): Promise<Set<PilotId>> {
  if (candidatePilotIds && candidatePilotIds.length === 0) return new Set()

  try {
    const rows = await db
      .select({ pilotId: follows.pilotId })
      .from(follows)
      .where(and(eq(follows.userId, userId), candidatePilotIds && inArray(follows.pilotId, candidatePilotIds)))
    return new Set(rows.map((row) => row.pilotId))
  } catch (error) {
    console.error('[follows] failed to load followed pilot ids:', error)
    throw new FollowsQueryError(`Failed to load followed pilot ids for user ${userId}`, { cause: error })
  }
}
