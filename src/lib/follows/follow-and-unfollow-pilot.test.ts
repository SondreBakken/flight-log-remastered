// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createTestDatabase,
  createTestUser,
  createUnmigratedTestDatabase,
  type TestDatabase,
} from '@/lib/db/test-database'
import { followPilot } from './follow-pilot'
import { unfollowPilot } from './unfollow-pilot'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

async function findFollowerIds(pilotId: number): Promise<string[]> {
  const { rows } = await testDatabase.client.query<{ user_id: string }>(
    'select user_id from follows where pilot_id = $1 order by user_id',
    [pilotId],
  )
  return rows.map((row) => row.user_id)
}

describe('followPilot', () => {
  it('inserts the follow as the given user only', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await followPilot(testDatabase.db, { userId, pilotId: 7001 })).toEqual({ kind: 'followed' })
    expect(await findFollowerIds(7001)).toEqual([userId])
  })

  it('treats following an already-followed pilot as success, keeping one row', async () => {
    const userId = await createTestUser(testDatabase.client)
    await followPilot(testDatabase.db, { userId, pilotId: 7002 })

    expect(await followPilot(testDatabase.db, { userId, pilotId: 7002 })).toEqual({ kind: 'followed' })
    expect(await findFollowerIds(7002)).toEqual([userId])
  })

  it('reports a db-error when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await followPilot(unmigrated.db, { userId: 'user-abc', pilotId: 7003 })).toEqual({
      kind: 'db-error',
      message: 'failed to follow this pilot',
    })
    await unmigrated.client.close()
  })
})

describe('unfollowPilot', () => {
  it("removes the user's own follow and leaves another user's follow of the same pilot", async () => {
    const userId = await createTestUser(testDatabase.client)
    const otherUserId = await createTestUser(testDatabase.client)
    await followPilot(testDatabase.db, { userId, pilotId: 7004 })
    await followPilot(testDatabase.db, { userId: otherUserId, pilotId: 7004 })

    expect(await unfollowPilot(testDatabase.db, { userId, pilotId: 7004 })).toEqual({ kind: 'unfollowed' })
    expect(await findFollowerIds(7004)).toEqual([otherUserId])
  })

  it('treats unfollowing a pilot that was never followed as success', async () => {
    const userId = await createTestUser(testDatabase.client)

    expect(await unfollowPilot(testDatabase.db, { userId, pilotId: 7005 })).toEqual({ kind: 'unfollowed' })
  })

  it('reports a db-error when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmigrated = createUnmigratedTestDatabase()

    expect(await unfollowPilot(unmigrated.db, { userId: 'user-abc', pilotId: 7006 })).toEqual({
      kind: 'db-error',
      message: 'failed to unfollow this pilot',
    })
    await unmigrated.client.close()
  })
})
