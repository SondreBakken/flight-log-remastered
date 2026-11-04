import { sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { postgresErrorCode } from '@/lib/db/postgres-error-code'

// A comment id that isn't a uuid: Postgres rejects it before any row is looked at.
const INVALID_TEXT_REPRESENTATION = '22P02'

export type DeleteCommentInput = {
  id: string
  userId: string
}

export type DeleteCommentResult = { kind: 'deleted' } | { kind: 'not-found' } | { kind: 'db-error'; message: string }

// Soft delete only, and only the author's own comment: soft_delete_own_comment
// (drizzle/0002_domain_functions.sql) matches on both the comment id and input.userId, which must
// be the session's user id. Someone else's comment, an already deleted one and an unknown id all
// come back as 'not-found', so the result never reveals whose comment it was.
export async function deleteComment(db: Database, input: DeleteCommentInput): Promise<DeleteCommentResult> {
  try {
    const isDeleted = await softDeleteOwnComment(db, input)
    return isDeleted ? { kind: 'deleted' } : { kind: 'not-found' }
  } catch (error) {
    if (postgresErrorCode(error) === INVALID_TEXT_REPRESENTATION) return { kind: 'not-found' }
    console.error('[comments] failed to delete comment:', error)
    return { kind: 'db-error', message: 'failed to delete the comment' }
  }
}

async function softDeleteOwnComment(db: Database, { id, userId }: DeleteCommentInput): Promise<boolean> {
  const result = await db.execute<{ deleted: boolean }>(sql`select soft_delete_own_comment(${userId}, ${id}) as deleted`)
  return result.rows[0].deleted
}
