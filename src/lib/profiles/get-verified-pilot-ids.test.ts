// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createTestVerification,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { getVerifiedPilotIds } from './get-verified-pilot-ids'
import { ProfilesQueryError } from './profiles-query-error'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function createVerifiedUser(pilotId: number, status = 'verified'): Promise<string> {
  const userId = await createTestUser(testDatabase.client)
  await createTestVerification(testDatabase.db, { userId, status, flightlogPilotId: pilotId, email: 'pilot@example.test' })
  return userId
}

describe('getVerifiedPilotIds', () => {
  it("returns the viewer's own verified pilot id", async () => {
    const viewerUserId = await createVerifiedUser(7001)

    expect(await getVerifiedPilotIds(testDatabase.db, viewerUserId, [7001])).toEqual(new Set([7001]))
  })

  it('leaves out a pilot id whose verification is still pending', async () => {
    const viewerUserId = await createVerifiedUser(7002, 'pending')

    expect(await getVerifiedPilotIds(testDatabase.db, viewerUserId, [7002])).toEqual(new Set())
  })

  it("never reports another user's verified pilot id to the viewer", async () => {
    const viewerUserId = await createTestUser(testDatabase.client)
    await createVerifiedUser(7003)

    expect(await getVerifiedPilotIds(testDatabase.db, viewerUserId, [7003])).toEqual(new Set())
  })

  it('returns an empty set without querying for no pilot ids', async () => {
    const unmigrated = createUnmigratedTestDatabase()

    expect(await getVerifiedPilotIds(unmigrated.db, 'user-abc', [])).toEqual(new Set())
    await unmigrated.client.close()
  })

  it('throws a ProfilesQueryError when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    await expect(getVerifiedPilotIds(unmigrated.db, 'user-abc', [7004])).rejects.toBeInstanceOf(ProfilesQueryError)
    await unmigrated.client.close()
  })
})
