// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { profiles } from '@/lib/db/schema'
import {
  createTestComment,
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { CommentsQueryError } from './comments-query-error'
import { getComments } from './get-comments'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

describe('getComments', () => {
  it("returns only the given flight's comments, oldest first, with each author's display name or null", async () => {
    const namedAuthorId = await createTestUser(database.client)
    const unnamedAuthorId = await createTestUser(database.client)
    await database.db.insert(profiles).values({ userId: namedAuthorId, displayName: 'Alex' })
    const newestId = await createTestComment(database.db, {
      userId: unnamedAuthorId,
      tripId: 101,
      body: 'second',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    const oldestId = await createTestComment(database.db, {
      userId: namedAuthorId,
      tripId: 101,
      body: 'first',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    await createTestComment(database.db, { userId: namedAuthorId, tripId: 102 })

    expect(await getComments(database.db, 101)).toEqual([
      { id: oldestId, userId: namedAuthorId, body: 'first', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
      { id: newestId, userId: unnamedAuthorId, body: 'second', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
    ])
  })

  // Former RLS read policy: a deleted comment is hidden from every reader, its author included.
  it('never returns a soft-deleted comment', async () => {
    const authorId = await createTestUser(database.client)
    const visibleId = await createTestComment(database.db, { userId: authorId, tripId: 103 })
    await createTestComment(database.db, { userId: authorId, tripId: 103, deletedAt: new Date() })

    const visibleComments = await getComments(database.db, 103)

    expect(visibleComments.map((comment) => comment.id)).toEqual([visibleId])
  })

  it('throws a CommentsQueryError, not an empty list, when the query fails, keeping the driver error as cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getComments(unmigrated.db, 101).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CommentsQueryError)
    expect((error as CommentsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
