// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { CertificateLevel } from '@/lib/certificates/types'
import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  findTestProfile,
  type TestDatabase,
} from '@/lib/db/test-database'
import { updateCertificateLevel } from './update-certificate-level'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

describe('updateCertificateLevel', () => {
  it('inserts the profile row with the level and when it was set, for a user who has none yet', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await updateCertificateLevel(testDatabase.db, { userId, level: 'PP3' })).toEqual({ kind: 'saved' })

    const profile = await findTestProfile(testDatabase.db, userId)
    expect(profile?.certificateLevel).toBe('PP3')
    expect(profile?.certificateLevelSetAt).toBeInstanceOf(Date)
  })

  it("updates only the given user's own row, re-stamping when it was set and leaving another user's untouched", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    const earlier = new Date('2026-01-01T00:00:00Z')
    await createTestProfile(testDatabase.db, { userId, displayName: 'Alex', certificateLevel: 'PP4', certificateLevelSetAt: earlier })
    await createTestProfile(testDatabase.db, { userId: otherUserId, certificateLevel: 'PP5', certificateLevelSetAt: earlier })

    await updateCertificateLevel(testDatabase.db, { userId, level: 'PP2' })

    const profile = await findTestProfile(testDatabase.db, userId)
    expect(profile).toMatchObject({ displayName: 'Alex', certificateLevel: 'PP2' })
    expect(profile?.certificateLevelSetAt?.getTime()).toBeGreaterThan(earlier.getTime())
    expect(await findTestProfile(testDatabase.db, otherUserId)).toMatchObject({ certificateLevel: 'PP5', certificateLevelSetAt: earlier })
  })

  it('reports a db-error for a level the database does not accept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const userId = await createTestUser(testDatabase.client)

    expect(await updateCertificateLevel(testDatabase.db, { userId, level: 'PP9' as CertificateLevel })).toEqual({
      kind: 'db-error',
      message: 'failed to save the certificate level',
    })
  })

  it('reports a db-error when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await updateCertificateLevel(unmigrated.db, { userId: 'user-abc', level: 'PP3' })).toEqual({
      kind: 'db-error',
      message: 'failed to save the certificate level',
    })
    await unmigrated.client.close()
  })
})
