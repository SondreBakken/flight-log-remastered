import { isValidPilotId, type PilotId } from '@/lib/flightlog/types'

// flightlog.org's own rqtid=21 `ts` field: a fixed-width YYYYMMDDHHMMSS string. Lexicographic
// comparison is correct for that format (same-length zero-padded digit strings sort the same
// as their numeric value would) and avoids parsing a timestamp this app never needs as a Date.
export type Timestamp = string

// Same rationale as follow-ids.ts's STORED_RAW_MAX_LENGTH: reject a hostile/corrupted payload
// by length before ever handing it to JSON.parse. A separate constant (not a re-export of
// follow-ids.ts's own) because this store's payload shape differs (an object of id->timestamp
// pairs, not a bare array of ids) even though the two limits currently happen to match.
export const STORED_RAW_MAX_LENGTH = 20_000

export function isValidTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'string' && /^\d{14}$/.test(value)
}

// Same shape as follow-ids.ts's StoredIdsRead, and for the same reason: a raw stored value can
// fail to represent a watermark map at all (corrupted JSON, wrong shape, over length, or a
// non-empty object none of whose entries survive validation), and that must be distinguishable
// from a genuinely empty map — see parseStoredWatermarks below.
export type StoredWatermarksRead =
  | { readonly ok: true; readonly watermarks: ReadonlyMap<PilotId, Timestamp> }
  | { readonly ok: false }

export function parseStoredWatermarks(raw: string | null): StoredWatermarksRead {
  if (raw === null || raw.length > STORED_RAW_MAX_LENGTH) return { ok: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }

  const rawEntries = Object.entries(parsed as Record<string, unknown>)
  const watermarks = new Map<PilotId, Timestamp>()
  for (const [key, value] of rawEntries) {
    const pilotId = Number(key)
    if (!isValidPilotId(pilotId) || !isValidTimestamp(value)) continue
    watermarks.set(pilotId, value)
  }
  // A non-empty object where every entry fails validation is corruption, not "no watermarks
  // recorded yet" — mirrors follow-ids.ts's parseStoredIds. An empty object has no entries to
  // fail, so it is unaffected and still succeeds with an empty map.
  if (rawEntries.length > 0 && watermarks.size === 0) return { ok: false }
  return { ok: true, watermarks }
}

export function serializeWatermarks(watermarks: ReadonlyMap<PilotId, Timestamp>): string {
  return JSON.stringify(Object.fromEntries(watermarks))
}

export function removeWatermark(watermarks: ReadonlyMap<PilotId, Timestamp>, pilotId: PilotId): Map<PilotId, Timestamp> {
  const next = new Map(watermarks)
  next.delete(pilotId)
  return next
}

// The only place a stored watermark is ever moved forward. Strictly greater-than, not
// greater-than-or-equal: reusing the newest `ts` shown (see feed.ts's shownTrackedTsByPilot) as
// the candidate is exactly the inclusive-boundary bug this store exists to avoid — flight
// comparison against the watermark (also strict `>`, see feed.ts's classifyTrackedNewness) means
// a flight whose `ts` equals the watermark is correctly "not new", but the watermark ITSELF must
// still accept being set to that same value once; only a candidate that is not an improvement
// over what's already stored is a no-op here. A candidate for a pilot with no prior watermark
// always wins (`current === undefined`).
//
// Note the equal-candidate case (`candidateTs === current`) is a no-op EITHER way this
// comparison is written (`>` or `>=`): the resulting map's contents are byte-identical, so no
// test observing only the returned/stored value can ever distinguish the two operators here —
// see watermark-ids.test.ts and check-watermark-store.mts for where that boundary actually is
// observable (classifyTrackedNewness above the store, not this function).
export function advanceWatermark(
  watermarks: ReadonlyMap<PilotId, Timestamp>,
  pilotId: PilotId,
  candidateTs: Timestamp,
): Map<PilotId, Timestamp> {
  const next = new Map(watermarks)
  if (!isValidPilotId(pilotId) || !isValidTimestamp(candidateTs)) return next
  const current = next.get(pilotId)
  if (current === undefined || candidateTs > current) next.set(pilotId, candidateTs)
  return next
}
