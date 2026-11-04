// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  findTestProfile,
  type TestDatabase,
} from '@/lib/db/test-database'
import { updateFlightlogPilotId } from './update-flightlog-pilot-id'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

const pilotExists = async () => true

async function createVerification(userId: string, pilotId: number): Promise<void> {
  await testDatabase.client.query(
    `insert into profile_verifications (user_id, status, flightlog_pilot_id, email) values ($1, 'verified', $2, 'pilot@example.test')`,
    [userId, pilotId],
  )
}

async function hasVerification(userId: string): Promise<boolean> {
  const { rows } = await testDatabase.client.query('select 1 from profile_verifications where user_id = $1', [userId])
  return rows.length > 0
}

describe('updateFlightlogPilotId', () => {
  it('rejects a pilot id flightlog.org does not know, without writing', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await updateFlightlogPilotId(testDatabase.db, { userId, pilotId: 999999 }, async () => false)).toEqual({
      kind: 'invalid-pilot-id',
    })
    expect(await findTestProfile(testDatabase.db, userId)).toBeUndefined()
  })

  it('inserts the profile row for a user who has none yet', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await updateFlightlogPilotId(testDatabase.db, { userId, pilotId: 12677 }, pilotExists)).toEqual({ kind: 'saved' })
    expect((await findTestProfile(testDatabase.db, userId))?.flightlogPilotId).toBe(12677)
  })

  it("updates only the given user's own row, leaving another user's untouched", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, displayName: 'Alex', flightlogPilotId: 1 })
    await createTestProfile(testDatabase.db, { userId: otherUserId, flightlogPilotId: 2 })

    await updateFlightlogPilotId(testDatabase.db, { userId, pilotId: 3 }, pilotExists)

    expect(await findTestProfile(testDatabase.db, userId)).toMatchObject({ displayName: 'Alex', flightlogPilotId: 3 })
    expect((await findTestProfile(testDatabase.db, otherUserId))?.flightlogPilotId).toBe(2)
  })

  it('drops the verification of the old pilot id when relinking to a different one', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, flightlogPilotId: 4 })
    await createVerification(userId, 4)

    await updateFlightlogPilotId(testDatabase.db, { userId, pilotId: 5 }, pilotExists)

    expect(await hasVerification(userId)).toBe(false)
  })

  it('keeps the verification when the same pilot id is saved again', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, flightlogPilotId: 6 })
    await createVerification(userId, 6)

    await updateFlightlogPilotId(testDatabase.db, { userId, pilotId: 6 }, pilotExists)

    expect(await hasVerification(userId)).toBe(true)
  })

  it('reports a db-error when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await updateFlightlogPilotId(unmigrated.db, { userId: 'user-abc', pilotId: 7 }, pilotExists)).toEqual({
      kind: 'db-error',
      message: 'failed to save the flightlog pilot id',
    })
    await unmigrated.client.close()
  })
})
