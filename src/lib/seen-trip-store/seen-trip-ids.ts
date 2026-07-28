import { isValidPilotId, type PilotId } from '@/lib/flightlog/types'

// A flight with no uploaded GPS track has no row on flightlog.org's rqtid=21 tracklog index,
// and therefore no `ts` anywhere to compare against (see feed.ts's classifyNewness for the
// tracked half of this same problem). The only signal available for "have I shown this
// UNTRACKED flight before" is the flight's own trip id, remembered per pilot — hence a set of
// ids rather than a single timestamp. `Flight.tripId` itself (see flightlog/types.ts).
export type TripId = number

// isSafeInteger, not isInteger: same rationale as isValidPilotId (flightlog/types.ts) — values
// past 2^53 still pass isInteger after float coercion but are not real trip ids. A separate
// predicate, not a reuse of isValidPilotId: the runtime check happens to be identical, but
// naming a trip-id check after pilots would misdescribe what it validates.
function isValidTripId(value: unknown): value is TripId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// Same rationale as watermark-ids.ts's own STORED_RAW_MAX_LENGTH: reject a hostile/corrupted
// payload by length before ever handing it to JSON.parse. A separate constant (not a re-export
// of either existing store's own) because this store's payload shape differs again (an object
// of id->array-of-ids pairs) even though the limit currently happens to match both.
export const STORED_RAW_MAX_LENGTH = 20_000

// Same shape as watermark-ids.ts's StoredWatermarksRead, for the same reason: a raw stored
// value can fail to represent this store's map at all (corrupted JSON, wrong shape, over
// length, or a non-empty object none of whose entries survive validation), and that must be
// distinguishable from a genuinely empty map — see parseStoredSeenTrips below.
export type StoredSeenTripsRead =
  | { readonly ok: true; readonly seenTripIdsByPilot: ReadonlyMap<PilotId, ReadonlySet<TripId>> }
  | { readonly ok: false }

export function parseStoredSeenTrips(raw: string | null): StoredSeenTripsRead {
  if (raw === null || raw.length > STORED_RAW_MAX_LENGTH) return { ok: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }

  const rawEntries = Object.entries(parsed as Record<string, unknown>)
  const seenTripIdsByPilot = new Map<PilotId, ReadonlySet<TripId>>()
  for (const [key, value] of rawEntries) {
    const pilotId = Number(key)
    if (!isValidPilotId(pilotId) || !Array.isArray(value)) continue
    const tripIds = new Set(value.filter(isValidTripId))
    // An entry whose array survives validation but ends up empty (every element invalid, or
    // the array was genuinely empty) carries no information — dropping it here means it reads
    // back identically to "this pilot was never written", rather than persisting as a
    // needless empty entry that the write-side would also never produce.
    if (tripIds.size === 0) continue
    seenTripIdsByPilot.set(pilotId, tripIds)
  }
  // A non-empty object where every entry fails validation is corruption, not "nothing
  // remembered yet" — mirrors watermark-ids.ts's parseStoredWatermarks. An empty object has no
  // entries to fail, so it is unaffected and still succeeds with an empty map.
  if (rawEntries.length > 0 && seenTripIdsByPilot.size === 0) return { ok: false }
  return { ok: true, seenTripIdsByPilot }
}

export function serializeSeenTrips(seenTripIdsByPilot: ReadonlyMap<PilotId, ReadonlySet<TripId>>): string {
  return JSON.stringify(
    Object.fromEntries([...seenTripIdsByPilot.entries()].map(([pilotId, tripIds]) => [pilotId, [...tripIds]])),
  )
}

export function removeSeenTripIds(
  seenTripIdsByPilot: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
  pilotId: PilotId,
): Map<PilotId, ReadonlySet<TripId>> {
  const next = new Map(seenTripIdsByPilot)
  next.delete(pilotId)
  return next
}

// The one place a pilot's remembered untracked-trip set is ever written.
//
// Neither a pure REPLACE (next = renderedTripIds) nor a pure UNION (next = previous ∪
// renderedTripIds) is correct here. A pure replace forgets an id that was shown on an earlier
// load but got crowded out of THIS load's merged feed by other pilots' newer flights — that id
// would wrongly read as new again if it ever renders again later. A pure union grows without
// bound as a pilot logs more flights over the seasons, exactly the unbounded-growth risk this
// store exists to design against.
//
// The rule this function implements instead: a pilot's remembered set is always a SUBSET of
// `fetchedTripIds` — the untracked trip ids actually fetched for this pilot on THIS load (their
// RECENT_FLIGHTS_PER_PILOT-bounded slice, see feed.ts). Of that fetched scope, an id is kept
// if it was already remembered before (still relevant — an id that ages out of the fetch
// window entirely will never be evaluated again, so remembering it forever buys nothing) OR it
// was actually rendered this load (`renderedTripIds`, a subset of `fetchedTripIds` by
// construction — see feed.ts's shownUntrackedTripIdsByPilot). Never anything else: an id that
// was fetched but not previously remembered and not rendered this load must NOT be added — the
// same "remember only what was actually rendered" rule #5 already applies to the watermark
// (see watermark-ids.ts's advanceWatermark and feed.ts's shownTrackedTsByPilot).
//
// This keeps the per-pilot bound real (the result can never exceed `fetchedTripIds.size`, which
// is itself bounded by RECENT_FLIGHTS_PER_PILOT) while still resolving the crowded-out tension:
// an id shown before and still in scope survives even a load where it doesn't render again.
export function replaceSeenTripIds(
  seenTripIdsByPilot: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
  pilotId: PilotId,
  fetchedTripIds: ReadonlySet<TripId>,
  renderedTripIds: ReadonlySet<TripId>,
): Map<PilotId, ReadonlySet<TripId>> {
  const next = new Map(seenTripIdsByPilot)
  if (!isValidPilotId(pilotId)) return next

  const previous = next.get(pilotId) ?? new Set<TripId>()
  const stillInScope = [...previous].filter((tripId) => fetchedTripIds.has(tripId))
  const merged = new Set([...stillInScope, ...renderedTripIds])

  if (merged.size === 0) next.delete(pilotId)
  else next.set(pilotId, merged)
  return next
}
