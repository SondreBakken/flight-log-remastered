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
import { updateCertificateChecklistItem } from './update-certificate-checklist-item'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function findChecklist(userId: string) {
  return (await findTestProfile(testDatabase.db, userId))?.certificateChecklist
}

describe('updateCertificateChecklistItem', () => {
  it('inserts the profile row with just this item, for a user who has none yet', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(
      await updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP4', requirementId: 'safety-course', checked: true }),
    ).toEqual({ kind: 'saved' })
    expect(await findChecklist(userId)).toEqual({ PP4: { 'safety-course': true } })
  })

  it('sets the item while keeping the other items of the same level and every other level', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, {
      userId,
      certificateChecklist: { PP3: { 'theory-exam': true }, PP4: { 'reserve-throw': true, 'safety-course': true } },
    })

    await updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP4', requirementId: 'safety-course', checked: false })

    expect(await findChecklist(userId)).toEqual({
      PP3: { 'theory-exam': true },
      PP4: { 'reserve-throw': true, 'safety-course': false },
    })
  })

  it('starts a level that has no items yet', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, displayName: 'Alex', certificateChecklist: { PP3: { 'theory-exam': true } } })

    await updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP5', requirementId: 'xc-flights', checked: true })

    expect(await findChecklist(userId)).toEqual({ PP3: { 'theory-exam': true }, PP5: { 'xc-flights': true } })
    expect((await findTestProfile(testDatabase.db, userId))?.displayName).toBe('Alex')
  })

  it("updates only the given user's own row, leaving another user's untouched", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId: otherUserId, certificateChecklist: { PP4: { 'safety-course': false } } })

    await updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP4', requirementId: 'safety-course', checked: true })

    expect(await findChecklist(otherUserId)).toEqual({ PP4: { 'safety-course': false } })
  })

  it('keeps both items when two different items are toggled concurrently', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId })

    await Promise.all([
      updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP4', requirementId: 'safety-course', checked: true }),
      updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP4', requirementId: 'reserve-throw', checked: true }),
      updateCertificateChecklistItem(testDatabase.db, { userId, level: 'PP3', requirementId: 'theory-exam', checked: true }),
    ])

    expect(await findChecklist(userId)).toEqual({
      PP3: { 'theory-exam': true },
      PP4: { 'safety-course': true, 'reserve-throw': true },
    })
  })

  it('reports a db-error when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(
      await updateCertificateChecklistItem(unmigrated.db, { userId: 'user-abc', level: 'PP4', requirementId: 'safety-course', checked: true }),
    ).toEqual({ kind: 'db-error', message: 'failed to save the checklist item' })
    await unmigrated.client.close()
  })
})
