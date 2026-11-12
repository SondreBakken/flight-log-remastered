// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, createTestUser, type TestDatabase } from '@/lib/db/test-database'
import { followedTakeoffs, follows } from '@/lib/db/schema'
import { backfillFollowNames, type NameFetchers } from './backfill-follow-names'

let testDatabase: TestDatabase

beforeAll(async () => {
  testDatabase = await createTestDatabase()
})

afterAll(async () => {
  await testDatabase.client.close()
})

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Counts and fetch calls are asserted on the whole table, so each test starts from empty.
  await testDatabase.client.query('delete from follows')
  await testDatabase.client.query('delete from followed_takeoffs')
})

function fetchersReturning(pilots: Record<number, string | null>, takeoffs: Record<number, string | null> = {}) {
  return {
    fetchPilotName: vi.fn(async (pilotId: number) => pilots[pilotId] ?? null),
    fetchTakeoffName: vi.fn(async ({ takeoffId }: { takeoffId: number }) => takeoffs[takeoffId] ?? null),
  } satisfies NameFetchers
}

async function pilotNames(): Promise<Record<number, string | null>> {
  const rows = await testDatabase.db.select({ pilotId: follows.pilotId, name: follows.name }).from(follows)
  return Object.fromEntries(rows.map((row) => [row.pilotId, row.name]))
}

async function takeoffNames(): Promise<Record<string, string | null>> {
  const rows = await testDatabase.db.select().from(followedTakeoffs)
  return Object.fromEntries(rows.map((row) => [`${row.countryId}/${row.takeoffId}`, row.name]))
}

describe('backfillFollowNames', () => {
  it('fills null names for pilots and takeoffs and reports the counts', async () => {
    const userId = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values({ userId, pilotId: 1, name: null })
    await testDatabase.db.insert(followedTakeoffs).values({ userId, countryId: 160, takeoffId: 5, name: null })

    const result = await backfillFollowNames(
      testDatabase.db,
      fetchersReturning({ 1: 'Ada Pilot' }, { 5: 'Hamar' }),
    )

    expect(result).toEqual({ filled: 2, stillNull: 0 })
    expect(await pilotNames()).toEqual({ 1: 'Ada Pilot' })
    expect(await takeoffNames()).toEqual({ '160/5': 'Hamar' })
  })

  it('selects only null-name rows: never looks up or overwrites a stored name', async () => {
    const userId = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values([
      { userId, pilotId: 1, name: 'Stored Name' },
      { userId, pilotId: 2, name: null },
    ])
    await testDatabase.db
      .insert(followedTakeoffs)
      .values({ userId, countryId: 160, takeoffId: 5, name: 'Stored Takeoff' })
    const fetchers = fetchersReturning({ 1: 'Different', 2: 'Filled' }, { 5: 'Different' })

    const result = await backfillFollowNames(testDatabase.db, fetchers)

    expect(result).toEqual({ filled: 1, stillNull: 0 })
    expect(fetchers.fetchPilotName).toHaveBeenCalledTimes(1)
    expect(fetchers.fetchPilotName).toHaveBeenCalledWith(2)
    expect(fetchers.fetchTakeoffName).not.toHaveBeenCalled()
    expect(await pilotNames()).toEqual({ 1: 'Stored Name', 2: 'Filled' })
    expect(await takeoffNames()).toEqual({ '160/5': 'Stored Takeoff' })
  })

  it('fills every user\'s null row for a pilot from one lookup', async () => {
    const first = await createTestUser(testDatabase.client)
    const second = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values([
      { userId: first, pilotId: 1, name: null },
      { userId: second, pilotId: 1, name: null },
    ])
    const fetchers = fetchersReturning({ 1: 'Ada Pilot' })

    expect(await backfillFollowNames(testDatabase.db, fetchers)).toEqual({ filled: 2, stillNull: 0 })
    expect(fetchers.fetchPilotName).toHaveBeenCalledTimes(1)
  })

  it("never overwrites another user's stored name for the same pilot or takeoff", async () => {
    const nullUser = await createTestUser(testDatabase.client)
    const namedUser = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values([
      { userId: nullUser, pilotId: 1, name: null },
      { userId: namedUser, pilotId: 1, name: 'Stored Name' },
    ])
    await testDatabase.db.insert(followedTakeoffs).values([
      { userId: nullUser, countryId: 160, takeoffId: 5, name: null },
      { userId: namedUser, countryId: 160, takeoffId: 5, name: 'Stored Takeoff' },
    ])

    const result = await backfillFollowNames(testDatabase.db, fetchersReturning({ 1: 'Fresh' }, { 5: 'Fresh' }))

    expect(result).toEqual({ filled: 2, stillNull: 0 })
    const names = await testDatabase.client.query<{ name: string }>(
      'select name from follows union all select name from followed_takeoffs order by name',
    )
    expect(names.rows.map((row) => row.name)).toEqual(['Fresh', 'Fresh', 'Stored Name', 'Stored Takeoff'])
  })

  it('leaves the name null when the lookup fails, finds nothing, or the takeoff is null, and counts it', async () => {
    const userId = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values([
      { userId, pilotId: 1, name: null },
      { userId, pilotId: 2, name: null },
    ])
    await testDatabase.db.insert(followedTakeoffs).values({ userId, countryId: 160, takeoffId: 5, name: null })
    const fetchers = {
      fetchPilotName: vi.fn(async (pilotId: number) => {
        if (pilotId === 1) throw new Error('flightlog.org down')
        return null
      }),
      fetchTakeoffName: vi.fn(async () => null),
    }

    const result = await backfillFollowNames(testDatabase.db, fetchers)

    expect(result).toEqual({ filled: 0, stillNull: 3 })
    expect(await pilotNames()).toEqual({ 1: null, 2: null })
    expect(await takeoffNames()).toEqual({ '160/5': null })
  })

  it('fills 0 on a second run once no name is null', async () => {
    const userId = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(follows).values({ userId, pilotId: 1, name: null })
    await testDatabase.db.insert(followedTakeoffs).values({ userId, countryId: 160, takeoffId: 5, name: null })
    await backfillFollowNames(testDatabase.db, fetchersReturning({ 1: 'Ada Pilot' }, { 5: 'Hamar' }))
    const secondFetchers = fetchersReturning({ 1: 'Other' }, { 5: 'Other' })

    expect(await backfillFollowNames(testDatabase.db, secondFetchers)).toEqual({ filled: 0, stillNull: 0 })
    expect(secondFetchers.fetchPilotName).not.toHaveBeenCalled()
    expect(secondFetchers.fetchTakeoffName).not.toHaveBeenCalled()
    expect(await pilotNames()).toEqual({ 1: 'Ada Pilot' })
  })

  it('keeps the same takeoffId in two countries as separate lookups', async () => {
    const userId = await createTestUser(testDatabase.client)
    await testDatabase.db.insert(followedTakeoffs).values([
      { userId, countryId: 160, takeoffId: 5, name: null },
      { userId, countryId: 203, takeoffId: 5, name: null },
    ])
    const fetchers = {
      fetchPilotName: vi.fn(async () => null),
      fetchTakeoffName: vi.fn(async ({ countryId }: { countryId: number }) => `Takeoff in ${countryId}`),
    }

    await backfillFollowNames(testDatabase.db, fetchers)

    expect(await takeoffNames()).toEqual({ '160/5': 'Takeoff in 160', '203/5': 'Takeoff in 203' })
  })
})
