import { followedTakeoffs } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { TakeoffRef } from '@/lib/flightlog/types'

export type FollowTakeoffInput = TakeoffRef & {
  userId: string
  name: string | null
}

export type FollowTakeoffResult = { kind: 'followed' } | { kind: 'db-error'; message: string }

// userId must be the session's own id (see follow-button/actions.ts), same rule as followPilot.
// The takeoff is keyed by (countryId, takeoffId): flightlog.org numbers takeoffs per country, so
// the id alone is ambiguous. Following an already-followed takeoff is a success.
export async function followTakeoff(db: Database, input: FollowTakeoffInput): Promise<FollowTakeoffResult> {
  try {
    await db
      .insert(followedTakeoffs)
      .values({ userId: input.userId, countryId: input.countryId, takeoffId: input.takeoffId, name: input.name })
      .onConflictDoNothing()
    return { kind: 'followed' }
  } catch (error) {
    console.error('[follows] failed to insert takeoff follow:', error)
    return { kind: 'db-error', message: 'failed to follow this takeoff' }
  }
}
