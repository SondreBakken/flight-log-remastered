// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { followTakeoff } from './follow-takeoff'
import { unfollowTakeoff } from './unfollow-takeoff'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function findFollowRows(takeoffId: number): Promise<{ user_id: string; country_id: number }[]> {
  const { rows } = await testDatabase.client.query<{ user_id: string; country_id: number }>(
    'select user_id, country_id from followed_takeoffs where takeoff_id = $1 order by user_id, country_id',
    [takeoffId],
  )
  return rows
}

describe('followTakeoff', () => {
  it('inserts the follow as the given user only', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await followTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8001 })).toEqual({
      kind: 'followed',
    })
    expect(await findFollowRows(8001)).toEqual([{ user_id: userId, country_id: 160 }])
  })

  it('treats following an already-followed takeoff as success, keeping one row', async () => {
    const userId = await createTestUser(testDatabase.client)
    await followTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8002 })

    expect(await followTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8002 })).toEqual({
      kind: 'followed',
    })
    expect(await findFollowRows(8002)).toEqual([{ user_id: userId, country_id: 160 }])
  })

  it('keeps the same takeoffId in two countries as two rows', async () => {
    const userId = await createTestUser(testDatabase.client)
    await followTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8003 })
    await followTakeoff(testDatabase.db, { userId, countryId: 203, takeoffId: 8003 })

    expect(await findFollowRows(8003)).toEqual([
      { user_id: userId, country_id: 160 },
      { user_id: userId, country_id: 203 },
    ])
  })

  it('reports a db-error when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await followTakeoff(unmigrated.db, { userId: 'user-abc', countryId: 160, takeoffId: 8004 })).toEqual({
      kind: 'db-error',
      message: 'failed to follow this takeoff',
    })
    await unmigrated.client.close()
  })
})

describe('unfollowTakeoff', () => {
  it("removes the user's own follow and leaves another user's follow and the other country's row", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await followTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8005 })
    await followTakeoff(testDatabase.db, { userId, countryId: 203, takeoffId: 8005 })
    await followTakeoff(testDatabase.db, { userId: otherUserId, countryId: 160, takeoffId: 8005 })

    expect(await unfollowTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8005 })).toEqual({
      kind: 'unfollowed',
    })
    expect(await findFollowRows(8005)).toEqual(
      expect.arrayContaining([
        { user_id: userId, country_id: 203 },
        { user_id: otherUserId, country_id: 160 },
      ]),
    )
    expect(await findFollowRows(8005)).toHaveLength(2)
  })

  it('treats unfollowing a takeoff that was never followed as success', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await unfollowTakeoff(testDatabase.db, { userId, countryId: 160, takeoffId: 8006 })).toEqual({
      kind: 'unfollowed',
    })
  })

  it('reports a db-error when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await unfollowTakeoff(unmigrated.db, { userId: 'user-abc', countryId: 160, takeoffId: 8007 })).toEqual({
      kind: 'db-error',
      message: 'failed to unfollow this takeoff',
    })
    await unmigrated.client.close()
  })
})
