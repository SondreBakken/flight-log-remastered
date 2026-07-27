import type { Flight, Pilot } from '@/lib/flightlog/types'

// The one wire shape for this route, shared by the route handler (server) and
// fetch-pilot-feed.ts (client) so they cannot drift apart the way an inline object type on
// one side and a hand-copied one on the other can. `error` is deliberately just a stable,
// non-upstream-derived string — see the route handler's doc comment for why.
export type RecentFlightsSuccessBody = {
  pilot: Pilot
  flights: Flight[]
  trackedTripIds: number[]
}

export type RecentFlightsErrorBody = {
  error: string
}

// Mirrors tracks.ts's isTrackIndexResponse: validates the response envelope shape before
// trusting it, rather than casting — the response crossed a network boundary (this app's
// own route, but still `unknown` on arrival), so a shape mismatch must be a handled failure
// for that pilot, not a runtime crash reading `.pilot` off something else.
export function isRecentFlightsSuccessBody(value: unknown): value is RecentFlightsSuccessBody {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.pilot === 'object' &&
    candidate.pilot !== null &&
    Array.isArray(candidate.flights) &&
    Array.isArray(candidate.trackedTripIds)
  )
}
