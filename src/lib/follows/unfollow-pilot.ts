import { and, eq } from 'drizzle-orm'
import { follows } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { PilotId } from '@/lib/flightlog/types'

export type UnfollowPilotInput = {
  userId: string
  pilotId: PilotId
}

export type UnfollowPilotResult = { kind: 'unfollowed' } | { kind: 'db-error'; message: string }

// Scoped to userId, the session's own id: the filter is what keeps one user from removing another
// user's follow of the same pilot. A follow that does not exist is a success, since its absence
// is the desired end state.
export async function unfollowPilot(db: Database, input: UnfollowPilotInput): Promise<UnfollowPilotResult> {
  try {
    await db.delete(follows).where(and(eq(follows.userId, input.userId), eq(follows.pilotId, input.pilotId)))
    return { kind: 'unfollowed' }
  } catch (error) {
    console.error('[follows] failed to delete follow:', error)
    return { kind: 'db-error', message: 'failed to unfollow this pilot' }
  }
}
