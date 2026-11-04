import { and, count, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { comments } from '@/lib/db/schema'

// The spec's rate limit (docs/superpowers/specs/2026-08-10-social-features-design.md, Comments):
// 5 or more comments already posted in the trailing minute rejects the next one.
const RATE_LIMIT_WINDOW = sql`now() - interval '1 minute'`
const RATE_LIMIT_MAX_COMMENTS = 5

export type PostCommentInput = {
  tripId: number
  userId: string
  body: string
}

export type PostCommentResult =
  | { kind: 'posted' }
  | { kind: 'empty-body' }
  | { kind: 'rate-limited' }
  | { kind: 'db-error'; message: string }

// input.userId must be the session's user id, never a client-supplied one: the insert below
// writes it as the author, which is the whole "insert only as self" rule now that RLS is gone.
export async function postComment(db: Database, input: PostCommentInput): Promise<PostCommentResult> {
  if (isBlank(input.body)) return { kind: 'empty-body' }

  const recentCount = await countRecentComments(db, input.userId).catch((error: unknown) => {
    console.error('[comments] failed to check the comment rate limit:', error)
    return null
  })
  if (recentCount === null) return { kind: 'db-error', message: 'failed to check the rate limit' }
  if (recentCount >= RATE_LIMIT_MAX_COMMENTS) return { kind: 'rate-limited' }

  try {
    await db.insert(comments).values({ tripId: input.tripId, userId: input.userId, body: input.body.trim() })
  } catch (error) {
    console.error('[comments] failed to insert comment:', error)
    return { kind: 'db-error', message: 'failed to save the comment' }
  }

  return { kind: 'posted' }
}

function isBlank(body: string): boolean {
  return body.trim().length === 0
}

// Deleted comments still count: deleting a comment must not free up room to post another.
async function countRecentComments(db: Database, userId: string): Promise<number> {
  const [{ recentCount }] = await db
    .select({ recentCount: count() })
    .from(comments)
    .where(and(eq(comments.userId, userId), gt(comments.createdAt, RATE_LIMIT_WINDOW)))
  return recentCount
}
