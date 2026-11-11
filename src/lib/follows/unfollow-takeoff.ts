import { and, eq } from 'drizzle-orm'
import { followedTakeoffs } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { TakeoffRef } from '@/lib/flightlog/types'

export type UnfollowTakeoffInput = TakeoffRef & {
  userId: string
}

export type UnfollowTakeoffResult = { kind: 'unfollowed' } | { kind: 'db-error'; message: string }

// Scoped to userId, the session's own id, so one user cannot remove another's follow. A follow
// that does not exist is a success: its absence is the desired end state.
export async function unfollowTakeoff(db: Database, input: UnfollowTakeoffInput): Promise<UnfollowTakeoffResult> {
  try {
    await db
      .delete(followedTakeoffs)
      .where(
        and(
          eq(followedTakeoffs.userId, input.userId),
          eq(followedTakeoffs.countryId, input.countryId),
          eq(followedTakeoffs.takeoffId, input.takeoffId),
        ),
      )
    return { kind: 'unfollowed' }
  } catch (error) {
    console.error('[follows] failed to delete takeoff follow:', error)
    return { kind: 'db-error', message: 'failed to unfollow this takeoff' }
  }
}
