import type { Flight, Pilot, TrackIndexEntry } from '@/lib/flightlog/types'

// The one wire shape for this route, shared by the route handler (server) and
// fetch-pilot-feed.ts (client) so they cannot drift apart the way an inline object type on
// one side and a hand-copied one on the other can. `error` is deliberately just a stable,
// non-upstream-derived string — see the route handler's doc comment for why.
//
// `trackedTrips` carries each tracked flight's `ts`, not just its tripId (issue #5): the feed
// needs it to tell a newly-updated track apart from one already seen. That timestamp comes
// from data this route already fetches (see getTrackedTripEntries) — it is free.
export type RecentFlightsSuccessBody = {
  pilot: Pilot
  flights: Flight[]
  trackedTrips: TrackIndexEntry[]
}

export type RecentFlightsErrorBody = {
  error: string
}

function isTrackIndexEntry(value: unknown): value is TrackIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.tripId === 'number' && typeof candidate.updatedAt === 'string'
}

// Transitional: this route's response is cached for up to max-age=60 plus
// stale-while-revalidate=300 (route.ts's CACHE_CONTROL) — up to ~6 minutes after a deploy, a
// client can still receive a response body cached from BEFORE `trackedTrips:
// TrackIndexEntry[]` replaced the older `trackedTripIds: number[]` shape. Requiring only the
// new shape turned that ordinary cache staleness into a hard failure (the amber "could not be
// loaded" banner) for every followed pilot, for that whole window. The legacy shape carries no
// `updatedAt`, so a flight read through it is honestly untrackable for newness (see feed.ts's
// FlightNewness) until the next real fetch replaces the cached body — the same kind of honest
// degradation MAX_YEARS_PER_PILOT already gives an inactive pilot's older flights, not a crash
// or a false claim. Drop this once this deploy has aged out of every CDN/browser cache (bounded
// by the Cache-Control window above), not on any fixed calendar date.
function legacyTrackedTrips(candidate: Record<string, unknown>): TrackIndexEntry[] | null {
  if (!Array.isArray(candidate.trackedTripIds)) return null
  if (!candidate.trackedTripIds.every((id): id is number => typeof id === 'number')) return null
  return candidate.trackedTripIds.map((tripId) => ({ tripId, updatedAt: '' }))
}

// Validated at the boundary, not cast — this crossed a network hop (our own route, but still
// `unknown` on arrival), so a shape mismatch must be a handled failure for that pilot, not a
// runtime crash reading `.pilot` off something else. Returns the normalized body (always the
// current `trackedTrips` shape) rather than a boolean, so callers never need to know the legacy
// shape exists at all.
export function parseRecentFlightsSuccessBody(value: unknown): RecentFlightsSuccessBody | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.pilot !== 'object' || candidate.pilot === null) return null
  if (!Array.isArray(candidate.flights)) return null

  const trackedTrips =
    Array.isArray(candidate.trackedTrips) && candidate.trackedTrips.every(isTrackIndexEntry)
      ? candidate.trackedTrips
      : legacyTrackedTrips(candidate)
  if (trackedTrips === null) return null

  return { pilot: candidate.pilot as Pilot, flights: candidate.flights as Flight[], trackedTrips }
}
