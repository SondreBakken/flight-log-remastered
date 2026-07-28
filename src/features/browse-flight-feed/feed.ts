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
  // reason). `null` means this pilot has never been seen before.
  watermarkAtLoad: string | null
}

export type PilotFeedFailure = {
  status: 'error'
  pilotId: number
  message: string
}

export type PilotFeedResult = PilotFeedSuccess | PilotFeedFailure

// The shape fetch-pilot-feed.ts (infra: talks to our own route handler over HTTP, nothing
// else) can honestly return. It cannot report `watermarkAtLoad` — that's a localStorage read,
// and this module never touches localStorage — so the caller (use-flight-feed.ts) attaches it
// right after, from getWatermark, before this ever becomes a real PilotFeedResult.
export type FetchedPilotFeedSuccess = Omit<PilotFeedSuccess, 'watermarkAtLoad'>
export type FetchedPilotFeedResult = FetchedPilotFeedSuccess | PilotFeedFailure

// A flight's "new since last visit" status is one of three states, never collapsed to two:
//   - 'new': tracked, and its ts is newer than the pilot's watermark at the start of this load.
//   - 'not-new': tracked, and its ts is at or before the watermark.
//   - 'unknown': untracked — flightlog.org's rqtid=21 has no row, and therefore no timestamp,
//     for a flight with no uploaded GPS track (confirmed live: a pilot with real flights and
//     zero uploaded tracks gets a 200 with an empty data_items array). "We cannot tell" and
//     "this is not new" are different claims — collapsing this into 'not-new' would render an
//     unchecked flight as confidently checked, which this repo has shipped five times already
//     for a structurally identical reason (#25, #6, #32, #8, #59). See classifyNewness.
export type FlightNewness = 'new' | 'not-new' | 'unknown'

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
function classifyNewness(trackedAt: string | null, watermarkAtLoad: string | null): FlightNewness {
  if (trackedAt === null) return 'unknown'
  if (watermarkAtLoad === null) return 'new'
  return trackedAt > watermarkAtLoad ? 'new' : 'not-new'
}

function toFeedEntries(result: PilotFeedSuccess): FeedEntry[] {
  const trackedAtByTripId = new Map(result.trackedTrips.map((entry) => [entry.tripId, entry.updatedAt]))
  return result.flights.map((flight) => {
    const trackedAt = trackedAtByTripId.get(flight.tripId) ?? null
    return {
      pilot: result.pilot,
      flight,
      hasTrack: trackedAt !== null,
      newness: classifyNewness(trackedAt, result.watermarkAtLoad),
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
// mean. Counts 'new' only: 'unknown' (untracked) flights are neither new nor not-new, and must
// not inflate this number one way or the other — see FlightNewness's doc comment.
export function countNewEntries(entries: readonly FeedEntry[]): number {
  return entries.filter((entry) => entry.newness === 'new').length
}

// The per-pilot advance candidate for use-flight-feed.ts's watermark update, derived from
// entries actually RENDERED in the merged, FEED_SIZE-truncated feed — never from every flight
// fetched. A flight truncated out of the merge, or belonging to a pilot whose slice never made
// the cut, must not be marked "seen": the user never saw it (this was the bug — a fetched-but-
// unrendered flight silently advanced the watermark past itself, with no way to un-see it).
// Only entries with a resolved track ts (trackedAt !== null) can advance anything; an 'unknown'
// entry has no ts to advance to.
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

// Whether ANY successfully-loaded pilot had a recorded watermark before this load — false only
// when every one of them is being seen for the very first time. Drives the "since your last
// visit" caption (see index.tsx's NewSinceLastVisitNotice): a genuine first-time visitor has no
// "last visit" to report a count against, however many flights read as 'new' by construction of
// classifyNewness's null-watermark case above.
export function anyPilotHasPriorWatermark(results: readonly PilotFeedResult[]): boolean {
  return results.some((result) => result.status === 'success' && result.watermarkAtLoad !== null)
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
