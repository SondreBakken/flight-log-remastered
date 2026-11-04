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
import { getCommentsForTripIds } from './get-comments-for-trip-ids'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

describe('getCommentsForTripIds', () => {
  it('short-circuits to an empty list without querying when there are no trip ids', async () => {
    const unmigrated = createUnmigratedTestDatabase()

    expect(await getCommentsForTripIds(unmigrated.db, [])).toEqual([])
    await unmigrated.client.close()
  })

  it('returns comments on any of the given flights, newest first, with each author display name or null', async () => {
    const namedAuthorId = await createTestUser(database.client)
    const unnamedAuthorId = await createTestUser(database.client)
    await database.db.insert(profiles).values({ userId: namedAuthorId, displayName: 'Alex' })
    const olderId = await createTestComment(database.db, {
      userId: namedAuthorId,
      tripId: 201,
      body: 'first',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    const newerId = await createTestComment(database.db, {
      userId: unnamedAuthorId,
      tripId: 202,
      body: 'second',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    await createTestComment(database.db, { userId: namedAuthorId, tripId: 203 })

    expect(await getCommentsForTripIds(database.db, [201, 202])).toEqual([
      { id: newerId, tripId: 202, userId: unnamedAuthorId, body: 'second', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
      { id: olderId, tripId: 201, userId: namedAuthorId, body: 'first', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
    ])
  })

  // Former RLS read policy: a deleted comment is hidden from every reader, its author included.
  it('never returns a soft-deleted comment', async () => {
    const authorId = await createTestUser(database.client)
    const visibleId = await createTestComment(database.db, { userId: authorId, tripId: 204 })
    await createTestComment(database.db, { userId: authorId, tripId: 205, deletedAt: new Date() })

    const visibleComments = await getCommentsForTripIds(database.db, [204, 205])

    expect(visibleComments.map((comment) => comment.id)).toEqual([visibleId])
  })

  it('throws a CommentsQueryError, not an empty list, when the query fails, keeping the driver error as cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getCommentsForTripIds(unmigrated.db, [201]).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CommentsQueryError)
    expect((error as CommentsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
