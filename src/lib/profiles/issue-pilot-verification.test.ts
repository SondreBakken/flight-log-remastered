// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// generate-otp-code.ts guards node:crypto with 'server-only', which throws outside a react-server bundle.
vi.mock('server-only', () => ({}))

import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  findTestVerification,
  type TestDatabase,
} from '@/lib/db/test-database'
import { issuePilotVerification } from './issue-pilot-verification'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createLinkedUser(pilotId: number): Promise<string> {
  const userId = await createTestUser(testDatabase.client)
  await createTestProfile(testDatabase.db, { userId, flightlogPilotId: pilotId })
  return userId
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('issuePilotVerification', () => {
  it("issues a six-digit code bound to the user's linked pilot id and stores it pending", async () => {
    const userId = await createLinkedUser(900024)

    const result = await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')

    expect(result).toEqual({ kind: 'issued', code: expect.stringMatching(/^\d{6}$/), boundPilotId: 900024 })
    expect(await findTestVerification(testDatabase.db, userId)).toMatchObject({
      status: 'pending',
      flightlogPilotId: 900024,
      email: 'pilot@example.test',
    })
  })

  it('stores only the hash of the code and returns no hash to the caller', async () => {
    const userId = await createLinkedUser(4550)

    const result = await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')
    if (result.kind !== 'issued') throw new Error(`expected an issued code, got ${result.kind}`)

    const storedHash = (await findTestVerification(testDatabase.db, userId))?.otpCodeHash
    expect(storedHash).toBe(sha256Hex(result.code))
    expect(Object.keys(result).sort()).toEqual(['boundPilotId', 'code', 'kind'])
    expect(JSON.stringify(result)).not.toContain(storedHash)
  })

  it("writes only the given user's verification, leaving another user's untouched", async () => {
    const userId = await createLinkedUser(4551)
    const otherUserId = await createLinkedUser(4552)
    await issuePilotVerification(testDatabase.db, otherUserId, 'other@example.test')
    const otherBefore = await findTestVerification(testDatabase.db, otherUserId)

    await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')

    expect(await findTestVerification(testDatabase.db, otherUserId)).toEqual(otherBefore)
  })

  it('maps P0001 to no-linked-pilot-id when the user has no pilot id linked', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')).toEqual({ kind: 'no-linked-pilot-id' })
  })

  it('maps RL001 to rate-limited when a code was issued within the last minute', async () => {
    const userId = await createLinkedUser(4553)
    await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')

    expect(await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')).toEqual({ kind: 'rate-limited' })
  })

  it('throws a ProfilesQueryError for any other database failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(issuePilotVerification(unmigrated.db, 'user-abc', 'pilot@example.test')).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
