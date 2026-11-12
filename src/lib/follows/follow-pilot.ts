import { follows } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { PilotId } from '@/lib/flightlog/types'

export type FollowPilotInput = {
  userId: string
  pilotId: PilotId
  name: string | null
}

export type FollowPilotResult = { kind: 'followed' } | { kind: 'db-error'; message: string }

// userId must be the session's own id (see follow-button/actions.ts): with RLS gone, nothing in
// the database stops a row being written for someone else. Following an already-followed pilot is
// a success, since the end state is the same. A re-follow never rewrites the
// stored name (onConflictDoNothing), so a row first stored with a null name stays null until the
// backfill script fills it.
export async function followPilot(db: Database, input: FollowPilotInput): Promise<FollowPilotResult> {
  try {
    await db.insert(follows).values({ userId: input.userId, pilotId: input.pilotId, name: input.name }).onConflictDoNothing()
    return { kind: 'followed' }
  } catch (error) {
    console.error('[follows] failed to insert follow:', error)
    return { kind: 'db-error', message: 'failed to follow this pilot' }
  }
}
