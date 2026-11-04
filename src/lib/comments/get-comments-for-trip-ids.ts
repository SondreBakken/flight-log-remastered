import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { comments, profiles } from '@/lib/db/schema'
import { CommentsQueryError } from './comments-query-error'

// Its own type rather than a widened Comment: a flight page already knows its tripId from the
// URL, so only this many-flights caller (account-activity) needs it on each comment.
export type CommentWithTripId = {
  id: string
  tripId: number
  userId: string
  body: string
  createdAt: string
  displayName: string | null
}

// Every visible comment across a pilot's flights in one query, for account-activity. Same public
// read rule as getComments (deleted comments hidden from everyone), but newest first: this is an
// activity feed, not a thread read top to bottom.
//
// A query error throws a CommentsQueryError (#159); the caller's SectionErrorBoundary renders it.
export async function getCommentsForTripIds(db: Database, tripIds: number[]): Promise<CommentWithTripId[]> {
  if (tripIds.length === 0) return []

  const rows = await findVisibleCommentsOnTrips(db, tripIds).catch((error: unknown) => {
    console.error('[comments] failed to load comments for trip ids:', error)
    throw new CommentsQueryError(
      `Failed to load comments for ${tripIds.length} trip ${tripIds.length === 1 ? 'id' : 'ids'}`,
      { cause: error },
    )
  })
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

function findVisibleCommentsOnTrips(db: Database, tripIds: number[]) {
  return db
    .select({
      id: comments.id,
      tripId: comments.tripId,
      userId: comments.userId,
      body: comments.body,
      createdAt: comments.createdAt,
      displayName: profiles.displayName,
    })
    .from(comments)
    .leftJoin(profiles, eq(profiles.userId, comments.userId))
    .where(and(inArray(comments.tripId, tripIds), isNull(comments.deletedAt)))
    .orderBy(desc(comments.createdAt))
}
