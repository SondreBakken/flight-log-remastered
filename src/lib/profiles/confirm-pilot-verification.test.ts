// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  findTestVerification,
  type TestDatabase,
} from '@/lib/db/test-database'
import { confirmPilotVerification } from './confirm-pilot-verification'
import { issuePilotVerification } from './issue-pilot-verification'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createUserWithIssuedCode(pilotId: number): Promise<{ userId: string; code: string }> {
  const userId = await createTestUser(testDatabase.client)
  await createTestProfile(testDatabase.db, { userId, flightlogPilotId: pilotId })
  const result = await issuePilotVerification(testDatabase.db, userId, 'pilot@example.test')
  if (result.kind !== 'issued') throw new Error(`expected an issued code, got ${result.kind}`)
  return { userId, code: result.code }
}

function wrongCodeFor(code: string): string {
  return code === '000000' ? '111111' : '000000'
}

describe('confirmPilotVerification', () => {
  it("confirms the user's own pending verification with the issued code", async () => {
    const { userId, code } = await createUserWithIssuedCode(5001)

    expect(await confirmPilotVerification(testDatabase.db, userId, code)).toEqual({ kind: 'confirmed' })
    expect((await findTestVerification(testDatabase.db, userId))?.status).toBe('verified')
  })

  it('reports incorrect-or-expired for a wrong code', async () => {
    const { userId, code } = await createUserWithIssuedCode(5002)

    expect(await confirmPilotVerification(testDatabase.db, userId, wrongCodeFor(code))).toEqual({ kind: 'incorrect-or-expired' })
  })

  it("cannot confirm another user's verification, even with that user's code", async () => {
    const owner = await createUserWithIssuedCode(5003)
    const otherUserId = await createTestUser(testDatabase.client)

    expect(await confirmPilotVerification(testDatabase.db, otherUserId, owner.code)).toEqual({ kind: 'incorrect-or-expired' })
    expect((await findTestVerification(testDatabase.db, owner.userId))?.status).toBe('pending')
  })

  it('maps AL001 to locked-out after five failed attempts, even for the right code', async () => {
    const { userId, code } = await createUserWithIssuedCode(5004)
    for (let attempt = 0; attempt < 5; attempt++) {
      await confirmPilotVerification(testDatabase.db, userId, wrongCodeFor(code))
    }

    expect(await confirmPilotVerification(testDatabase.db, userId, code)).toEqual({ kind: 'locked-out' })
  })

  it('throws a ProfilesQueryError for any other database failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(confirmPilotVerification(unmigrated.db, 'user-abc', '123456')).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
