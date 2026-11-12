import { desc, eq } from 'drizzle-orm'
import { followedTakeoffs } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import { FollowsQueryError } from './follows-query-error'
import type { TakeoffRef } from '@/lib/flightlog/types'

export type FollowedTakeoffRow = TakeoffRef & { name: string | null; createdAt: Date }

// Every takeoff the user follows with its stored name and follow time, newest follow first.
// Separate from getFollowedTakeoffs, whose ascending (countryId, takeoffId) order decides which
// takeoffs survive the feed's cap and must not change. Throws a FollowsQueryError on a query error.
export async function getFollowedTakeoffRows(db: Database, userId: string): Promise<FollowedTakeoffRow[]> {
  try {
    return await db
      .select({
        countryId: followedTakeoffs.countryId,
        takeoffId: followedTakeoffs.takeoffId,
        name: followedTakeoffs.name,
        createdAt: followedTakeoffs.createdAt,
      })
      .from(followedTakeoffs)
      .where(eq(followedTakeoffs.userId, userId))
      .orderBy(desc(followedTakeoffs.createdAt), followedTakeoffs.countryId, followedTakeoffs.takeoffId)
  } catch (error) {
    console.error('[follows] failed to load followed takeoff rows:', error)
    throw new FollowsQueryError(`Failed to load followed takeoffs for user ${userId}`, { cause: error })
  }
}
