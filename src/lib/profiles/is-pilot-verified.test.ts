// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createTestVerification,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { isPilotVerified } from './is-pilot-verified'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

describe('isPilotVerified', () => {
  it("is true for a pilot someone else verified, since it is a public lookup that needs no viewer", async () => {
    const ownerUserId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, { userId: ownerUserId, status: 'verified', flightlogPilotId: 8001, email: 'pilot@example.test' })

    expect(await isPilotVerified(testDatabase.db, 8001)).toBe(true)
  })

  it('is false while the verification is still pending', async () => {
    const ownerUserId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, { userId: ownerUserId, status: 'pending', flightlogPilotId: 8002, email: 'pilot@example.test' })

    expect(await isPilotVerified(testDatabase.db, 8002)).toBe(false)
  })

  it('is false for a pilot nobody has verified', async () => {
    expect(await isPilotVerified(testDatabase.db, 8003)).toBe(false)
  })

  it('throws a ProfilesQueryError when the lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(isPilotVerified(unmigrated.db, 8004)).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
