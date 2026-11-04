// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { comments } from '@/lib/db/schema'
import {
  createTestComment,
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { deleteComment } from './delete-comment'
import { getComments } from './get-comments'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

async function findStoredComment(id: string) {
  const [row] = await database.db.select().from(comments).where(eq(comments.id, id))
  return row
}

// Former RLS rule: a comment is soft-deleted only by its author, through soft_delete_own_comment,
// and is never hard-deleted.
describe('deleteComment', () => {
  it("soft-deletes the author's own comment, hiding it from the public read but keeping the row", async () => {
    const authorId = await createTestUser(database.client)
    const commentId = await createTestComment(database.db, { userId: authorId, tripId: 401, body: 'oops' })

    expect(await deleteComment(database.db, { id: commentId, userId: authorId })).toEqual({ kind: 'deleted' })

    expect(await getComments(database.db, 401)).toEqual([])
    expect(await findStoredComment(commentId)).toMatchObject({ userId: authorId, tripId: 401, body: 'oops' })
    expect((await findStoredComment(commentId)).deletedAt).toBeInstanceOf(Date)
  })

  it("reports not-found and leaves the comment untouched when someone else tries to delete it", async () => {
    const authorId = await createTestUser(database.client)
    const otherUserId = await createTestUser(database.client)
    const commentId = await createTestComment(database.db, { userId: authorId, tripId: 402 })

    expect(await deleteComment(database.db, { id: commentId, userId: otherUserId })).toEqual({ kind: 'not-found' })

    expect((await findStoredComment(commentId)).deletedAt).toBeNull()
  })

  it('reports not-found when the comment is already deleted', async () => {
    const authorId = await createTestUser(database.client)
    const commentId = await createTestComment(database.db, { userId: authorId, tripId: 403 })
    await deleteComment(database.db, { id: commentId, userId: authorId })

    expect(await deleteComment(database.db, { id: commentId, userId: authorId })).toEqual({ kind: 'not-found' })
  })

  it('reports not-found for an unknown comment id, the same as for someone else’s', async () => {
    const userId = await createTestUser(database.client)

    expect(await deleteComment(database.db, { id: randomUUID(), userId })).toEqual({ kind: 'not-found' })
  })

  it('reports not-found, not a db-error, for a comment id that is not a uuid', async () => {
    const userId = await createTestUser(database.client)

    expect(await deleteComment(database.db, { id: 'not-a-uuid', userId })).toEqual({ kind: 'not-found' })
  })

  it('reports a db-error, without throwing, when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const result = await deleteComment(unmigrated.db, { id: randomUUID(), userId: 'user-a' })

    expect(result).toEqual({ kind: 'db-error', message: 'failed to delete the comment' })
    await unmigrated.client.close()
  })
})
