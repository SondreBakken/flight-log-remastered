// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { FollowsQueryError } from './follows-query-error'
import { getFollowersForPilot } from './get-followers-for-pilot'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createProfiledUser(profile: { pilotId?: number; displayName?: string } = {}): Promise<string> {
  const userId = await createTestUser(testDatabase.client)
  await testDatabase.client.query(
    'insert into profiles (user_id, flightlog_pilot_id, display_name) values ($1, $2, $3)',
    [userId, profile.pilotId ?? null, profile.displayName ?? null],
  )
  return userId
}

async function insertFollow(userId: string, pilotId: number, createdAt: string): Promise<void> {
  await testDatabase.client.query('insert into follows (user_id, pilot_id, created_at) values ($1, $2, $3)', [
    userId,
    pilotId,
    createdAt,
  ])
}

describe('getFollowersForPilot', () => {
  it("returns the pilot's followers, newest first, with display names, to the user who links that pilot", async () => {
    const ownerId = await createProfiledUser({ pilotId: 5001 })
    const namedFollowerId = await createProfiledUser({ displayName: 'Alice' })
    const anonymousFollowerId = await createTestUser(testDatabase.client)
    await insertFollow(namedFollowerId, 5001, '2026-08-01T00:00:00Z')
    await insertFollow(anonymousFollowerId, 5001, '2026-08-02T00:00:00Z')
    await insertFollow(namedFollowerId, 5999, '2026-08-03T00:00:00Z')

    expect(await getFollowersForPilot(testDatabase.db, ownerId, 5001)).toEqual([
      { userId: anonymousFollowerId, createdAt: '2026-08-02T00:00:00.000Z', displayName: null },
      { userId: namedFollowerId, createdAt: '2026-08-01T00:00:00.000Z', displayName: 'Alice' },
    ])
  })

  it('returns no followers to a viewer whose profile links a different pilot', async () => {
    await createProfiledUser({ pilotId: 5002 })
    const otherPilotOwnerId = await createProfiledUser({ pilotId: 6002 })
    await insertFollow(await createTestUser(testDatabase.client), 5002, '2026-08-01T00:00:00Z')

    expect(await getFollowersForPilot(testDatabase.db, otherPilotOwnerId, 5002)).toEqual([])
  })

  it('returns no followers to a viewer with no profile, or with no linked pilot', async () => {
    await createProfiledUser({ pilotId: 5003 })
    await insertFollow(await createTestUser(testDatabase.client), 5003, '2026-08-01T00:00:00Z')
    const viewerWithoutProfileId = await createTestUser(testDatabase.client)
    const viewerWithoutPilotId = await createProfiledUser()

    expect(await getFollowersForPilot(testDatabase.db, viewerWithoutProfileId, 5003)).toEqual([])
    expect(await getFollowersForPilot(testDatabase.db, viewerWithoutPilotId, 5003)).toEqual([])
  })

  it('throws a FollowsQueryError carrying the driver error as cause when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    const error = await getFollowersForPilot(unmigrated.db, 'user-abc', 4549).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/4549/)
    expect((error as FollowsQueryError).cause).toBeInstanceOf(Error)
    await unmigrated.client.close()
  })
})
