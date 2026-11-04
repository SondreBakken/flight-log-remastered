// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { getProfile } from './get-profile'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

describe('getProfile', () => {
  it("reads any user's profile, since profiles are public read", async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, displayName: 'Alex', flightlogPilotId: 12677 })

    expect(await getProfile(testDatabase.db, userId)).toEqual({ displayName: 'Alex', flightlogPilotId: 12677 })
  })

  it('reads an empty profile for a user who has never saved one', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await getProfile(testDatabase.db, userId)).toEqual({ displayName: null, flightlogPilotId: null })
  })

  it("reads the given user's profile, not another user's", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId: otherUserId, displayName: 'Someone else' })

    expect(await getProfile(testDatabase.db, userId)).toEqual({ displayName: null, flightlogPilotId: null })
  })

  it('throws a ProfilesQueryError, not an empty profile, when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(getProfile(unmigrated.db, 'user-abc')).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
