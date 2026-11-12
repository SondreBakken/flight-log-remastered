// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { followedTakeoffs } from '@/lib/db/schema'
import { FollowsQueryError } from './follows-query-error'
import { getFollowedTakeoffRows } from './get-followed-takeoff-rows'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function insertFollow(userId: string, takeoffId: number, name: string | null, createdAt: string, countryId = 160) {
  await testDatabase.db.insert(followedTakeoffs).values({ userId, countryId, takeoffId, name, createdAt: new Date(createdAt) })
}

describe('getFollowedTakeoffRows', () => {
  it('returns every followed takeoff newest follow first with its stored name', async () => {
    const userId = await createTestUser(testDatabase.client)
    await insertFollow(userId, 31, 'Oldest', '2026-01-01T00:00:00Z')
    await insertFollow(userId, 32, null, '2026-03-01T00:00:00Z')
    await insertFollow(userId, 33, 'Middle', '2026-02-01T00:00:00Z', 203)

    expect(await getFollowedTakeoffRows(testDatabase.db, userId)).toEqual([
      { countryId: 160, takeoffId: 32, name: null, createdAt: new Date('2026-03-01T00:00:00Z') },
      { countryId: 203, takeoffId: 33, name: 'Middle', createdAt: new Date('2026-02-01T00:00:00Z') },
      { countryId: 160, takeoffId: 31, name: 'Oldest', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])
  })

  it("never returns another user's follows", async () => {
    const otherUserId = await createTestUser(testDatabase.client)
    await insertFollow(otherUserId, 41, 'Other', '2026-01-01T00:00:00Z')
    const userId = await createTestUser(testDatabase.client)
    await insertFollow(userId, 42, 'Mine', '2026-01-01T00:00:00Z')

    expect(await getFollowedTakeoffRows(testDatabase.db, userId)).toEqual([
      { countryId: 160, takeoffId: 42, name: 'Mine', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])
  })

  it('returns an empty list for a user following no takeoffs', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await getFollowedTakeoffRows(testDatabase.db, userId)).toEqual([])
  })

  it('throws a FollowsQueryError carrying the driver error as cause when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getFollowedTakeoffRows(unmigrated.db, 'user-abc').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/user-abc/)
    expect((error as FollowsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
