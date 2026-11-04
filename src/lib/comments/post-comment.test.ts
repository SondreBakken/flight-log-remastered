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
import { postComment } from './post-comment'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

async function createRecentComments(userId: string, total: number, overrides: { createdAt?: Date; deletedAt?: Date } = {}) {
  for (let index = 0; index < total; index++) {
    await createTestComment(database.db, { userId, tripId: 300, ...overrides })
  }
}

function findCommentsBy(userId: string) {
  return database.db
    .select({ tripId: comments.tripId, userId: comments.userId, body: comments.body })
    .from(comments)
    .where(eq(comments.userId, userId))
}

describe('postComment', () => {
  it('rejects a whitespace-only body without inserting', async () => {
    const userId = await createTestUser(database.client)

    expect(await postComment(database.db, { tripId: 301, userId, body: '   ' })).toEqual({ kind: 'empty-body' })
    expect(await findCommentsBy(userId)).toEqual([])
  })

  // Former RLS insert policy: a comment can only be written as the signed-in user. The caller
  // passes the session's id; this proves that id, and nothing else, becomes the author.
  it('inserts the comment with the given author, flight and trimmed body', async () => {
    const userId = await createTestUser(database.client)

    expect(await postComment(database.db, { tripId: 302, userId, body: '  padded body  ' })).toEqual({ kind: 'posted' })
    expect(await findCommentsBy(userId)).toEqual([{ tripId: 302, userId, body: 'padded body' }])
  })

  it('rejects the post as rate-limited when 5 comments were already posted in the last minute', async () => {
    const userId = await createTestUser(database.client)
    await createRecentComments(userId, 5)

    expect(await postComment(database.db, { tripId: 303, userId, body: 'one too many' })).toEqual({ kind: 'rate-limited' })
    expect(await findCommentsBy(userId)).toHaveLength(5)
  })

  it('allows a 5th comment within the minute', async () => {
    const userId = await createTestUser(database.client)
    await createRecentComments(userId, 4)

    expect(await postComment(database.db, { tripId: 304, userId, body: 'fifth' })).toEqual({ kind: 'posted' })
  })

  it('does not count comments older than a minute', async () => {
    const userId = await createTestUser(database.client)
    await createRecentComments(userId, 5, { createdAt: new Date(Date.now() - 2 * 60_000) })

    expect(await postComment(database.db, { tripId: 305, userId, body: 'hello' })).toEqual({ kind: 'posted' })
  })

  it("does not count another user's recent comments", async () => {
    const otherUserId = await createTestUser(database.client)
    const userId = await createTestUser(database.client)
    await createRecentComments(otherUserId, 5)

    expect(await postComment(database.db, { tripId: 306, userId, body: 'hello' })).toEqual({ kind: 'posted' })
  })

  it('counts deleted comments, so deleting does not make room for more', async () => {
    const userId = await createTestUser(database.client)
    await createRecentComments(userId, 5, { deletedAt: new Date() })

    expect(await postComment(database.db, { tripId: 307, userId, body: 'hello' })).toEqual({ kind: 'rate-limited' })
  })

  it('reports a db-error, without throwing, when the rate-limit check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const result = await postComment(unmigrated.db, { tripId: 308, userId: 'user-a', body: 'hello' })

    expect(result).toEqual({ kind: 'db-error', message: 'failed to check the rate limit' })
    await unmigrated.client.close()
  })

  it('reports a db-error, without throwing, when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await postComment(database.db, { tripId: 309, userId: randomUUID(), body: 'no such user' })

    expect(result).toEqual({ kind: 'db-error', message: 'failed to save the comment' })
  })
})
