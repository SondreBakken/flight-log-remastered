// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { followPilot } from './follow-pilot'
import { FollowsQueryError } from './follows-query-error'
import { getFollowedPilotIds } from './get-followed-pilot-ids'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createUserFollowing(pilotIds: number[]): Promise<string> {
  const userId = await createTestUser(testDatabase.client)
  for (const pilotId of pilotIds) await followPilot(testDatabase.db, { userId, pilotId, name: null })
  return userId
}

describe('getFollowedPilotIds', () => {
  it('returns every pilot the user follows when no candidates are given', async () => {
    const userId = await createUserFollowing([900024, 12677])

    expect(await getFollowedPilotIds(testDatabase.db, userId)).toEqual(new Set([900024, 12677]))
  })

  it("never returns another user's follows", async () => {
    await createUserFollowing([900024, 777])
    const userId = await createUserFollowing([12677])

    expect(await getFollowedPilotIds(testDatabase.db, userId)).toEqual(new Set([12677]))
    expect(await getFollowedPilotIds(testDatabase.db, userId, [900024, 777, 12677])).toEqual(new Set([12677]))
  })

  it('narrows the result to the candidate pilot ids', async () => {
    const userId = await createUserFollowing([900024, 12677, 888])

    expect(await getFollowedPilotIds(testDatabase.db, userId, [900024, 999])).toEqual(new Set([900024]))
  })

  it('returns an empty Set for an empty candidate list', async () => {
    const userId = await createUserFollowing([900024])

    expect(await getFollowedPilotIds(testDatabase.db, userId, [])).toEqual(new Set())
  })

  it('throws a FollowsQueryError carrying the driver error as cause when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getFollowedPilotIds(unmigrated.db, 'user-abc').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/user-abc/)
    expect((error as FollowsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
