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
import { updateDisplayName } from './update-display-name'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

describe('updateDisplayName', () => {
  it('inserts the profile row for a user who has none yet', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await updateDisplayName(testDatabase.db, { userId, displayName: 'Alex' })).toEqual({ kind: 'saved' })
    expect((await findTestProfile(testDatabase.db, userId))?.displayName).toBe('Alex')
  })

  it("updates only the given user's own row, leaving another user's untouched", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, displayName: 'Old name' })
    await createTestProfile(testDatabase.db, { userId: otherUserId, displayName: 'Other' })

    await updateDisplayName(testDatabase.db, { userId, displayName: 'New name' })

    expect((await findTestProfile(testDatabase.db, userId))?.displayName).toBe('New name')
    expect((await findTestProfile(testDatabase.db, otherUserId))?.displayName).toBe('Other')
  })

  it('keeps the rest of the profile when updating an existing row', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, displayName: 'Old name', flightlogPilotId: 12677 })

    await updateDisplayName(testDatabase.db, { userId, displayName: 'New name' })

    expect((await findTestProfile(testDatabase.db, userId))?.flightlogPilotId).toBe(12677)
  })

  it('trims the name, and stores a blank one as null', async () => {
    const userId = await createTestUser(testDatabase.client)

    await updateDisplayName(testDatabase.db, { userId, displayName: '  Alex  ' })
    expect((await findTestProfile(testDatabase.db, userId))?.displayName).toBe('Alex')

    await updateDisplayName(testDatabase.db, { userId, displayName: '   ' })
    expect((await findTestProfile(testDatabase.db, userId))?.displayName).toBeNull()
  })

  it('reports a db-error when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await updateDisplayName(unmigrated.db, { userId: 'user-abc', displayName: 'Alex' })).toEqual({
      kind: 'db-error',
      message: 'failed to save the display name',
    })
    await unmigrated.client.close()
  })
})
