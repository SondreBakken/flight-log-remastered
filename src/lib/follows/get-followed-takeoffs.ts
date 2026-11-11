import { eq } from 'drizzle-orm'
import { followedTakeoffs } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import { FollowsQueryError } from './follows-query-error'
import type { TakeoffRef } from '@/lib/flightlog/types'

// Every takeoff the user follows, ascending by (countryId, takeoffId): the feed caps how many it
// fetches (MAX_TAKEOFFS_PER_FEED), so the order decides which ones survive the cap and must not
// depend on insertion order.
//
// A query error throws a FollowsQueryError rather than returning an empty list, same as
// getFollowedPilotIds (#155), so a broken read is never mistaken for "follows no takeoffs".
export async function getFollowedTakeoffs(db: Database, userId: string): Promise<TakeoffRef[]> {
  try {
    return await db
      .select({ countryId: followedTakeoffs.countryId, takeoffId: followedTakeoffs.takeoffId })
      .from(followedTakeoffs)
      .where(eq(followedTakeoffs.userId, userId))
      .orderBy(followedTakeoffs.countryId, followedTakeoffs.takeoffId)
  } catch (error) {
    console.error('[follows] failed to load followed takeoffs:', error)
    throw new FollowsQueryError(`Failed to load followed takeoffs for user ${userId}`, { cause: error })
  }
}
