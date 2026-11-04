import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { comments, profiles } from '@/lib/db/schema'
import { CommentsQueryError } from './comments-query-error'
import type { Comment } from './types'

// Public read: the same result for a signed-out visitor as for a signed-in one, and a deleted
// comment is hidden from everyone, its author included (the old RLS read policy, now an explicit
// where). Oldest first, so a newly posted comment appends to the bottom of the thread.
//
// A query error throws a CommentsQueryError rather than returning [] (#159), so a broken query is
// never mistaken for a flight with no comments; loadCommentsForFlight catches it by type.
export async function getComments(db: Database, tripId: number): Promise<Comment[]> {
  const rows = await findVisibleComments(db, tripId).catch((error: unknown) => {
    console.error('[comments] failed to load comments:', error)
    throw new CommentsQueryError(`Failed to load comments for trip ${tripId}`, { cause: error })
  })
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

function findVisibleComments(db: Database, tripId: number) {
  return db
    .select({
      id: comments.id,
      userId: comments.userId,
      body: comments.body,
      createdAt: comments.createdAt,
      displayName: profiles.displayName,
    })
    .from(comments)
    .leftJoin(profiles, eq(profiles.userId, comments.userId))
    .where(and(eq(comments.tripId, tripId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt))
}
