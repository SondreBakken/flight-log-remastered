// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createTestVerification,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { getOwnPilotVerification } from './get-own-pilot-verification'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

const OTP_CODE_HASH = 'a'.repeat(64)
const EXPIRES_AT = new Date('2026-08-13T10:32:00.000Z')

describe('getOwnPilotVerification', () => {
  it('reads none for a user who has never started verification', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await getOwnPilotVerification(testDatabase.db, userId)).toEqual({ kind: 'none' })
  })

  it('reads a pending verification with the email the code went to and its expiry', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, {
      userId,
      status: 'pending',
      otpCodeHash: OTP_CODE_HASH,
      otpExpiresAt: EXPIRES_AT,
      flightlogPilotId: 6001,
      email: 'pilot@example.test',
    })

    expect(await getOwnPilotVerification(testDatabase.db, userId)).toEqual({
      kind: 'pending',
      email: 'pilot@example.test',
      otpExpiresAt: EXPIRES_AT,
    })
  })

  it('reads a verified verification', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, { userId, status: 'verified', flightlogPilotId: 6002, email: 'pilot@example.test' })

    expect(await getOwnPilotVerification(testDatabase.db, userId)).toEqual({ kind: 'verified' })
  })

  it("reads only the given user's own verification, never another user's", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, {
      userId: otherUserId,
      status: 'verified',
      flightlogPilotId: 6003,
      email: 'other@example.test',
    })

    expect(await getOwnPilotVerification(testDatabase.db, userId)).toEqual({ kind: 'none' })
  })

  it('never returns the stored code hash', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestVerification(testDatabase.db, {
      userId,
      status: 'pending',
      otpCodeHash: OTP_CODE_HASH,
      otpExpiresAt: EXPIRES_AT,
      flightlogPilotId: 6004,
      email: 'pilot@example.test',
    })

    const verification = await getOwnPilotVerification(testDatabase.db, userId)

    expect(verification).not.toHaveProperty('otpCodeHash')
    expect(JSON.stringify(verification)).not.toContain(OTP_CODE_HASH)
  })

  it('throws a ProfilesQueryError, not none, when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(getOwnPilotVerification(unmigrated.db, 'user-abc')).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
