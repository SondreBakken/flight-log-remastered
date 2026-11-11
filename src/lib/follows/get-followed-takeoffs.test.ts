// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { followTakeoff } from './follow-takeoff'
import { FollowsQueryError } from './follows-query-error'
import { getFollowedTakeoffs } from './get-followed-takeoffs'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createUserFollowing(takeoffs: { countryId: number; takeoffId: number }[]): Promise<string> {
  const userId = await createTestUser(testDatabase.client)
  for (const takeoff of takeoffs) await followTakeoff(testDatabase.db, { userId, ...takeoff })
  return userId
}

describe('getFollowedTakeoffs', () => {
  it('returns every followed takeoff ascending by (countryId, takeoffId), whatever the insertion order', async () => {
    const userId = await createUserFollowing([
      { countryId: 203, takeoffId: 5 },
      { countryId: 160, takeoffId: 9 },
      { countryId: 160, takeoffId: 2 },
    ])

    expect(await getFollowedTakeoffs(testDatabase.db, userId)).toEqual([
      { countryId: 160, takeoffId: 2 },
      { countryId: 160, takeoffId: 9 },
      { countryId: 203, takeoffId: 5 },
    ])
  })

  it("never returns another user's follows", async () => {
    await createUserFollowing([{ countryId: 160, takeoffId: 777 }])
    const userId = await createUserFollowing([{ countryId: 160, takeoffId: 12 }])

    expect(await getFollowedTakeoffs(testDatabase.db, userId)).toEqual([{ countryId: 160, takeoffId: 12 }])
  })

  it('returns an empty list for a user following no takeoffs', async () => {
    const userId = await createUserFollowing([])

    expect(await getFollowedTakeoffs(testDatabase.db, userId)).toEqual([])
  })

  it('throws a FollowsQueryError carrying the driver error as cause when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getFollowedTakeoffs(unmigrated.db, 'user-abc').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/user-abc/)
    expect((error as FollowsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
