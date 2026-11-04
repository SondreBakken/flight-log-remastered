// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestProfile,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

describe('getCertificateProgressByPilotId', () => {
  it('reads the progress of the profile linked to the pilot id, for any viewer', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, {
      userId,
      flightlogPilotId: 8001,
      certificateLevel: 'PP3',
      certificateLevelSetAt: new Date('2026-08-27T10:00:00Z'),
      certificateChecklist: { PP4: { 'safety-course': true } },
    })

    expect(await getCertificateProgressByPilotId(testDatabase.db, 8001)).toEqual({
      userId,
      level: 'PP3',
      levelSetAt: '2026-08-27T10:00:00.000Z',
      checklist: { PP4: { 'safety-course': true } },
    })
  })

  it('reads an undeclared level as nulls and an empty checklist', async () => {
    const userId = await createTestUser(testDatabase.client)
    await createTestProfile(testDatabase.db, { userId, flightlogPilotId: 8002 })

    expect(await getCertificateProgressByPilotId(testDatabase.db, 8002)).toEqual({
      userId,
      level: null,
      levelSetAt: null,
      checklist: {},
    })
  })

  it('returns null when no profile has linked the pilot id', async () => {
    expect(await getCertificateProgressByPilotId(testDatabase.db, 8003)).toBeNull()
  })

  it('throws a ProfilesQueryError when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(getCertificateProgressByPilotId(unmigrated.db, 8004)).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
