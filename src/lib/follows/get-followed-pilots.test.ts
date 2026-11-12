// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { follows } from '@/lib/db/schema'
import { FollowsQueryError } from './follows-query-error'
import { getFollowedPilots } from './get-followed-pilots'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function insertFollow(userId: string, pilotId: number, name: string | null, createdAt: string) {
  await testDatabase.db.insert(follows).values({ userId, pilotId, name, createdAt: new Date(createdAt) })
}

describe('getFollowedPilots', () => {
  it('returns every followed pilot newest follow first with its stored name', async () => {
    const userId = await createTestUser(testDatabase.client)
    await insertFollow(userId, 31, 'Oldest Pilot', '2026-01-01T00:00:00Z')
    await insertFollow(userId, 32, null, '2026-03-01T00:00:00Z')
    await insertFollow(userId, 33, 'Middle Pilot', '2026-02-01T00:00:00Z')

    expect(await getFollowedPilots(testDatabase.db, userId)).toEqual([
      { pilotId: 32, name: null, createdAt: new Date('2026-03-01T00:00:00Z') },
      { pilotId: 33, name: 'Middle Pilot', createdAt: new Date('2026-02-01T00:00:00Z') },
      { pilotId: 31, name: 'Oldest Pilot', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])
  })

  it("never returns another user's follows", async () => {
    const otherUserId = await createTestUser(testDatabase.client)
    await insertFollow(otherUserId, 41, 'Other', '2026-01-01T00:00:00Z')
    const userId = await createTestUser(testDatabase.client)
    await insertFollow(userId, 42, 'Mine', '2026-01-01T00:00:00Z')

    expect(await getFollowedPilots(testDatabase.db, userId)).toEqual([
      { pilotId: 42, name: 'Mine', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])
  })

  it('returns an empty list for a user following no pilots', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await getFollowedPilots(testDatabase.db, userId)).toEqual([])
  })

  it('throws a FollowsQueryError carrying the driver error as cause when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getFollowedPilots(unmigrated.db, 'user-abc').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/user-abc/)
    expect((error as FollowsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
