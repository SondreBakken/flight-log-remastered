import { and, eq, isNull } from 'drizzle-orm'
import { followedTakeoffs, follows } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { PilotId, TakeoffRef } from '@/lib/flightlog/types'

// Each fetcher resolves a name, or null when flightlog.org has none; one that throws counts as null.
export type NameFetchers = {
  fetchPilotName: (pilotId: PilotId) => Promise<string | null>
  fetchTakeoffName: (takeoff: TakeoffRef) => Promise<string | null>
}

export type BackfillResult = { filled: number; stillNull: number }

// Fills names stored as null by follows made while flightlog.org was slow or down (and by rows that
// predate the name columns). Only `name is null` rows are selected and updated, so it never
// overwrites a name the follow action stored, and a second run with nothing null fills 0.
// Rows are looked up once per distinct pilot or takeoff, then every null row for it is updated.
export async function backfillFollowNames(db: Database, fetchers: NameFetchers): Promise<BackfillResult> {
  const pilots = await fillPilotNames(db, fetchers.fetchPilotName)
  const takeoffs = await fillTakeoffNames(db, fetchers.fetchTakeoffName)
  return { filled: pilots.filled + takeoffs.filled, stillNull: pilots.stillNull + takeoffs.stillNull }
}

async function fillPilotNames(db: Database, fetchPilotName: NameFetchers['fetchPilotName']): Promise<BackfillResult> {
  const pending = await db.selectDistinct({ pilotId: follows.pilotId }).from(follows).where(isNull(follows.name))
  const result: BackfillResult = { filled: 0, stillNull: 0 }
  for (const { pilotId } of pending) {
    const name = await nameOrNull(() => fetchPilotName(pilotId))
    const matching = and(eq(follows.pilotId, pilotId), isNull(follows.name))
    const updated = name
      ? await db.update(follows).set({ name }).where(matching).returning({ pilotId: follows.pilotId })
      : []
    result.filled += updated.length
    result.stillNull += name ? 0 : await countRows(db.select({ pilotId: follows.pilotId }).from(follows).where(matching))
  }
  return result
}

async function fillTakeoffNames(
  db: Database,
  fetchTakeoffName: NameFetchers['fetchTakeoffName'],
): Promise<BackfillResult> {
  const pending = await db
    .selectDistinct({ countryId: followedTakeoffs.countryId, takeoffId: followedTakeoffs.takeoffId })
    .from(followedTakeoffs)
    .where(isNull(followedTakeoffs.name))
  const result: BackfillResult = { filled: 0, stillNull: 0 }
  for (const takeoff of pending) {
    const name = await nameOrNull(() => fetchTakeoffName(takeoff))
    const matching = and(
      eq(followedTakeoffs.countryId, takeoff.countryId),
      eq(followedTakeoffs.takeoffId, takeoff.takeoffId),
      isNull(followedTakeoffs.name),
    )
    const updated = name
      ? await db.update(followedTakeoffs).set({ name }).where(matching).returning({ takeoffId: followedTakeoffs.takeoffId })
      : []
    result.filled += updated.length
    result.stillNull += name
      ? 0
      : await countRows(db.select({ takeoffId: followedTakeoffs.takeoffId }).from(followedTakeoffs).where(matching))
  }
  return result
}

async function nameOrNull(fetchName: () => Promise<string | null>): Promise<string | null> {
  try {
    return await fetchName()
  } catch (error) {
    console.error('[backfill-follow-names] lookup failed, leaving the name null:', error)
    return null
  }
}

async function countRows(query: PromiseLike<unknown[]>): Promise<number> {
  return (await query).length
}
