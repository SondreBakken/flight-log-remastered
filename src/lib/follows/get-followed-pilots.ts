import { desc, eq } from 'drizzle-orm'
import { follows } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

export type FollowedPilot = { pilotId: PilotId; name: string | null; createdAt: Date }

// Every pilot the user follows, newest follow first, with the name stored when they were
// followed (null when that lookup failed and the backfill has not run yet). Throws a
// FollowsQueryError on a query error, never an empty list, same as getFollowedPilotIds.
export async function getFollowedPilots(db: Database, userId: string): Promise<FollowedPilot[]> {
  try {
    return await db
      .select({ pilotId: follows.pilotId, name: follows.name, createdAt: follows.createdAt })
      .from(follows)
      .where(eq(follows.userId, userId))
      .orderBy(desc(follows.createdAt), follows.pilotId)
  } catch (error) {
    console.error('[follows] failed to load followed pilots:', error)
    throw new FollowsQueryError(`Failed to load followed pilots for user ${userId}`, { cause: error })
  }
}
