import type { Flight, Pilot, TrackIndexEntry } from '@/lib/flightlog/types'

// Each pilot's own recent slice must be at least as large as the merged feed: in the
// worst case one followed pilot supplies every entry, and slicing a pilot's history
// smaller than FEED_SIZE would silently drop flights that belonged in the final feed
// before the cross-pilot merge ever saw them.
export const FEED_SIZE = 30
export const RECENT_FLIGHTS_PER_PILOT = FEED_SIZE

// The traffic bound sliceRecentFlights's doc comment below promises: however many distinct
// years a pilot's RECENT_FLIGHTS_PER_PILOT slice actually touches (which for an inactive
// pilot can be far more than "one or two" — a pilot flying once a year spans as many years
// as the slice is deep), only the MOST RECENT this-many years are ever resolved for a GPS
// track. Flights whose year falls outside that window still render, just without a track
// link — a visible, honest degradation for an inactive pilot, not a silent one.
export const MAX_YEARS_PER_PILOT = 2

// Bounds how many followed pilots one feed load fetches at all, independent of the
// per-pilot year cap above: however tight the per-pilot request cost is, a follow list of
// unbounded size must not be allowed to fan out unboundedly. See selectFeedPilotIds.
export const MAX_PILOTS_PER_FEED = 20

export type PilotFeedSuccess = {
  status: 'success'
  pilotId: number
  pilot: Pilot
  flights: Flight[]
  trackedTrips: TrackIndexEntry[]
  // This pilot's watermark AS IT STOOD the instant their own fetch settled, captured by the
  // caller (use-flight-feed.ts) BEFORE it ever advances that watermark for this load — carried
  // on the result itself, rather than in a second map the caller must keep in sync by hand, so
  // "which watermark goes with which pilot's flights" cannot desynchronise from `results` (see
  // buildFeedEntries below, which used to take a separate watermarksAtLoad map for exactly this
  // reason). `null` means this pilot has never been seen before. Governs newness for TRACKED
  // flights only — see seenUntrackedTripIdsAtLoad for the untracked half (#62).
  watermarkAtLoad: string | null
  // The same capture-before-write discipline as watermarkAtLoad, for UNTRACKED flights: this
  // pilot's remembered set of previously-shown untracked trip ids, as it stood the instant
  // their fetch settled, from seen-trip-store (@/lib/seen-trip-store/storage). `null` means no
  // entry has ever been recorded for this pilot's untracked flights — either a genuine first
  // visit, or every previously-remembered id has since aged out of this pilot's fetch window
  // (see seen-trip-ids.ts's replaceSeenTripIds) — both read the same way in classifyNewness.
  seenUntrackedTripIdsAtLoad: ReadonlySet<number> | null
}

export type PilotFeedFailure = {
  status: 'error'
  pilotId: number
  message: string
}

export type PilotFeedResult = PilotFeedSuccess | PilotFeedFailure

// The shape fetch-pilot-feed.ts (infra: talks to our own route handler over HTTP, nothing
// else) can honestly return. It cannot report `watermarkAtLoad` or `seenUntrackedTripIdsAtLoad`
// — both are localStorage reads, and this module never touches localStorage — so the caller
// (use-flight-feed.ts) attaches them right after, before this ever becomes a real
// PilotFeedResult.
export type FetchedPilotFeedSuccess = Omit<PilotFeedSuccess, 'watermarkAtLoad' | 'seenUntrackedTripIdsAtLoad'>
export type FetchedPilotFeedResult = FetchedPilotFeedSuccess | PilotFeedFailure

// A flight's "new since last visit" status. Only ever two states now, not three: #62 gave
// untracked flights a real signal to check newness against (seen-trip-store's remembered trip
// ids, in place of the timestamp tracked flights compare against), so there is no longer a
// flight this repo cannot classify one way or the other. The 'unknown' state this type used to
// carry (untracked flights had no timestamp anywhere to check) is deliberately removed rather
// than kept as unreachable dead code — see classifyNewness, which now branches on hasTrack but
// resolves to 'new' or 'not-new' either way.
export type FlightNewness = 'new' | 'not-new'

export type FeedEntry = {
  pilot: Pilot
  flight: Flight
  hasTrack: boolean
  newness: FlightNewness
  // The tracked flight's own `ts`, or null when hasTrack is false. Carried on the entry (not
  // just folded into `newness`) so a caller can find the newest ts among the entries actually
  // SHOWN, per pilot, after the merge — see shownTrackedTsByPilot, which is what
  // use-flight-feed.ts advances each pilot's stored watermark to.
  trackedAt: string | null
}

export type RecentFlightsSlice = {
  flights: Flight[]
  years: number[]
}

function compareFlightsNewestFirst(a: Flight, b: Flight): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  // Same-day ties: an arbitrary but STABLE tiebreak (higher tripId first), needed
  // because two same-day flights would otherwise order however the source HTML happened
  // to list them, and that order is not something callers here control.
  return b.tripId - a.tripId
}

function sortFlightsNewestFirst(flights: Flight[]): Flight[] {
  return [...flights].sort(compareFlightsNewestFirst)
}

function yearOf(flight: Flight): number {
  return Number(flight.date.slice(0, 4))
}

/**
 * Slices a pilot's full history down to their most recent flights, AND derives which
 * years that slice touches — from the SLICE, never from the untrimmed history passed in,
 * and capped to the MAX_YEARS_PER_PILOT most recent of those years.
 *
 * The slice-not-history half is the traffic-safety property recorded in
 * docs/flightlog-api.md: resolving GPS tracks costs one request per pilot per year (see
 * getTrackedTripEntries in lib/flightlog/tracks.ts). But the slice alone does NOT bound the
 * year count: an infrequent pilot's RECENT_FLIGHTS_PER_PILOT most recent flights can still
 * span as many distinct years as the slice is deep (one flight a year for 30 years slices
 * to 30 years, not "one or two"). The explicit MAX_YEARS_PER_PILOT cap below is what
 * actually bounds it — flights outside the kept years still render, just without a track
 * link (see MAX_YEARS_PER_PILOT's doc comment).
 */
export function sliceRecentFlights(
  flights: Flight[],
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): RecentFlightsSlice {
  const recent = sortFlightsNewestFirst(flights).slice(0, limit)
  const years = [...new Set(recent.map(yearOf))]
    .sort((a, b) => b - a)
    .slice(0, MAX_YEARS_PER_PILOT)
  return { flights: recent, years }
}

/**
 * Orchestrates one pilot's slice of the route's response: slices the already-fetched
 * logbook, then resolves which of the sliced flights have a GPS track (and each one's `ts`)
 * via the injected `resolveTrackedTrips` (in production, getTrackedTripEntries — see
 * route.ts). Kept here rather than inline in the route handler, and infra-free (no
 * 'server-only'/'next/cache' import) specifically so it can be unit tested with a stub in
 * check-feed.mts: the years passed to `resolveTrackedTrips` coming from the SLICE, not the
 * pilot's full history, is exactly the traffic-safety property this function exists to
 * keep correct.
 */
export async function loadRecentFlightsForPilot(
  pilotId: number,
  logbook: { pilot: Pilot; flights: Flight[] },
  resolveTrackedTrips: (pilotId: number, years: number[]) => Promise<TrackIndexEntry[]>,
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): Promise<{ pilot: Pilot; flights: Flight[]; trackedTrips: TrackIndexEntry[] }> {
  const recent = sliceRecentFlights(logbook.flights, limit)
  const trackedTrips = await resolveTrackedTrips(pilotId, recent.years)
  return { pilot: logbook.pilot, flights: recent.flights, trackedTrips }
}

// Strictly greater-than, not greater-or-equal. The reason is NOT flightlog.org's own `ts=`
// query param semantics on the track-index request (tracks.ts hardcodes `ts=0` and fetches a
// whole year, then filters locally — the upstream param's own inclusivity is never exercised
// on this path). It's simpler than that: the watermark stores the newest `ts` this pilot has
// already had advanced to (see shownTrackedTsByPilot/advanceWatermark), so a flight whose own
// `ts` exactly equals the watermark is the flight that watermark was LAST set from — already
// seen, by construction. `watermarkAtLoad === null` (this pilot has never been seen before)
// means everything trackable is new, not nothing — the honest reading of "no watermark yet".
function classifyTrackedNewness(trackedAt: string, watermarkAtLoad: string | null): FlightNewness {
  if (watermarkAtLoad === null) return 'new'
  return trackedAt > watermarkAtLoad ? 'new' : 'not-new'
}

// The untracked counterpart, membership rather than a comparison: an untracked flight has no
// `ts` to compare, only its own trip id against the pilot's remembered set (see
// seen-trip-ids.ts's replaceSeenTripIds for how that set is maintained). `seenAtLoad === null`
// mirrors the tracked case's `watermarkAtLoad === null` exactly — no entry recorded yet reads
// as "new", the same honest first-visit default, not a fabricated "not new".
function classifyUntrackedNewness(tripId: number, seenAtLoad: ReadonlySet<number> | null): FlightNewness {
  if (seenAtLoad === null) return 'new'
  return seenAtLoad.has(tripId) ? 'not-new' : 'new'
}

function toFeedEntries(result: PilotFeedSuccess): FeedEntry[] {
  const trackedAtByTripId = new Map(result.trackedTrips.map((entry) => [entry.tripId, entry.updatedAt]))
  return result.flights.map((flight) => {
    const trackedAt = trackedAtByTripId.get(flight.tripId) ?? null
    return {
      pilot: result.pilot,
      flight,
      hasTrack: trackedAt !== null,
      newness:
        trackedAt !== null
          ? classifyTrackedNewness(trackedAt, result.watermarkAtLoad)
          : classifyUntrackedNewness(flight.tripId, result.seenUntrackedTripIdsAtLoad),
      trackedAt,
    }
  })
}

/**
 * Merges every followed pilot's already-sliced flights into one feed: flattens the
 * successful results, sorts newest first across ALL pilots (not per pilot), then slices
 * to the feed size. Failed pilots contribute no entries here — see failedPilotResults,
 * which surfaces them instead of letting them disappear silently.
 *
 * Each success result carries its own `watermarkAtLoad` (see PilotFeedSuccess) — read at the
 * start of this load, before any pilot's watermark advances — so classification here can never
 * observe a watermark that has already moved past what it's being compared against.
 */
export function buildFeedEntries(results: PilotFeedResult[], limit: number = FEED_SIZE): FeedEntry[] {
  const entries = results
    .filter((result): result is PilotFeedSuccess => result.status === 'success')
    .flatMap(toFeedEntries)
  entries.sort((a, b) => compareFlightsNewestFirst(a.flight, b.flight))
  return entries.slice(0, limit)
}

// The count the UI surfaces (see index.tsx) — among the flights actually shown, not among
// every flight fetched, since only shown flights are what "you've now seen this" can honestly
// mean. Counts 'new' only, tracked or untracked alike (#62 gave untracked flights the same
// two-state classification tracked ones already had — see FlightNewness's doc comment).
export function countNewEntries(entries: readonly FeedEntry[]): number {
  return entries.filter((entry) => entry.newness === 'new').length
}

// The per-pilot advance candidate for use-flight-feed.ts's watermark update, derived from
// entries actually RENDERED in the merged, FEED_SIZE-truncated feed — never from every flight
// fetched. A flight truncated out of the merge, or belonging to a pilot whose slice never made
// the cut, must not be marked "seen": the user never saw it (this was the bug — a fetched-but-
// unrendered flight silently advanced the watermark past itself, with no way to un-see it).
// Only entries with a resolved track ts (trackedAt !== null) can advance anything; an untracked
// entry has no ts to advance to — see shownUntrackedTripIdsByPilot for its counterpart.
export function shownTrackedTsByPilot(entries: readonly FeedEntry[]): Map<number, string> {
  const maxByPilot = new Map<number, string>()
  for (const entry of entries) {
    if (entry.trackedAt === null) continue
    const pilotId = entry.pilot.userId
    const current = maxByPilot.get(pilotId)
    if (current === undefined || entry.trackedAt > current) maxByPilot.set(pilotId, entry.trackedAt)
  }
  return maxByPilot
}

// The untracked counterpart to shownTrackedTsByPilot, feeding seen-trip-store's
// recordSeenUntracked instead of watermark-store's recordSeen: which untracked trip ids, per
// pilot, actually made it into the merged, FEED_SIZE-truncated feed. Same rule, same reason —
// only entries the user actually saw rendered may ever be remembered as seen (see
// seen-trip-ids.ts's replaceSeenTripIds doc comment for the full trap this guards against). A
// pilot contributing zero rendered untracked entries this load is simply absent from the
// returned map — use-flight-feed.ts only calls recordSeenUntracked for pilots present here, so
// that absence is what keeps such a pilot's stored set completely untouched.
export function shownUntrackedTripIdsByPilot(entries: readonly FeedEntry[]): Map<number, Set<number>> {
  const idsByPilot = new Map<number, Set<number>>()
  for (const entry of entries) {
    if (entry.trackedAt !== null) continue
    const pilotId = entry.pilot.userId
    const ids = idsByPilot.get(pilotId) ?? new Set<number>()
    ids.add(entry.flight.tripId)
    idsByPilot.set(pilotId, ids)
  }
  return idsByPilot
}

// This load's fetched-and-untracked scope, per successful pilot — the bound
// replaceSeenTripIds's replace formula relies on (see its own doc comment): a pilot's
// remembered set can never grow past however many untracked ids were actually fetched for
// them this load, which is itself bounded by RECENT_FLIGHTS_PER_PILOT. Includes EVERY
// successful pilot, even one with zero untracked flights (an empty Set, not a missing key) —
// unlike shownUntrackedTripIdsByPilot above, whose keys are exactly who to WRITE for. A
// failed pilot is excluded entirely: there is no fetched scope to prune against, and no read
// happened, so nothing about their stored entry should move (the second trap #62 calls out —
// #5 already got this right for watermarks).
export function fetchedUntrackedTripIdsByPilot(results: readonly PilotFeedResult[]): Map<number, Set<number>> {
  const idsByPilot = new Map<number, Set<number>>()
  for (const result of results) {
    if (result.status !== 'success') continue
    const trackedTripIds = new Set(result.trackedTrips.map((entry) => entry.tripId))
    const untrackedTripIds = new Set(
      result.flights.map((flight) => flight.tripId).filter((tripId) => !trackedTripIds.has(tripId)),
    )
    idsByPilot.set(result.pilotId, untrackedTripIds)
  }
  return idsByPilot
}

// Whether ANY successfully-loaded pilot has been seen before, from EITHER store — a recorded
// watermark (tracked flights) or a recorded seen-trip entry (untracked flights, #62). False
// only when every one of them is being seen for the very first time in both respects. Drives
// the "since your last visit" caption (see index.tsx's NewSinceLastVisitNotice): a genuine
// first-time visitor has no "last visit" to report a count against, however many flights read
// as 'new' by construction of classifyTrackedNewness/classifyUntrackedNewness's null-signal
// case above. Checking only watermarkAtLoad would be wrong on its own: a pilot who has been
// followed for months but has never uploaded a single GPS track (the exact case #62 exists
// for) would never accumulate a watermark, and would wrongly read as "first visit" forever.
export function anyPilotHasPriorVisit(results: readonly PilotFeedResult[]): boolean {
  return results.some(
    (result) =>
      result.status === 'success' &&
      (result.watermarkAtLoad !== null || result.seenUntrackedTripIdsAtLoad !== null),
  )
}

export function failedPilotResults(results: PilotFeedResult[]): PilotFeedFailure[] {
  return results.filter((result): result is PilotFeedFailure => result.status === 'error')
}

export type FeedPilotSelection = {
  pilotIds: number[]
  // The full followed count when truncation happened, so callers can show an honest notice
  // ("following 50, showing 20") instead of truncating silently — null means every followed
  // pilot is included.
  followedCount: number | null
}

/**
 * Bounds how many followed pilots one feed load fetches (MAX_PILOTS_PER_FEED), so a large
 * follow list cannot fan out into an unbounded number of per-pilot requests. Selection is
 * by ascending pilot id — arbitrary but deterministic, so the same pilots show on every
 * load rather than a different random subset each time.
 */
export function selectFeedPilotIds(
  followedIds: Iterable<number>,
  limit: number = MAX_PILOTS_PER_FEED,
): FeedPilotSelection {
  const sorted = [...followedIds].sort((a, b) => a - b)
  return {
    pilotIds: sorted.slice(0, limit),
    followedCount: sorted.length > limit ? sorted.length : null,
  }
}
