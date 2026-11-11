import type { NamedTakeoffRef } from '@/features/browse-flight-feed/feed'
import type { TakeoffFlight } from '@/lib/flightlog/types'

// The one wire shape for this route, shared by the route handler (server) and
// fetch-takeoff-feed.ts (client), same rationale as the pilot recent-flights contract. `error` is
// a stable, non-upstream-derived string: see route.ts for why.
export type TakeoffRecentFlightsSuccessBody = {
  takeoff: NamedTakeoffRef
  flights: TakeoffFlight[]
}

export type TakeoffRecentFlightsErrorBody = {
  error: string
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNamedTakeoffRef(value: unknown): value is NamedTakeoffRef {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.countryId === 'number' &&
    typeof candidate.takeoffId === 'number' &&
    typeof candidate.name === 'string'
  )
}

// Checks exactly the fields the feed's mapper reads and renders; the rest of TakeoffFlight comes
// from our own route and is passed through.
function isTakeoffFlight(value: unknown): value is TakeoffFlight {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.tripId === 'number' &&
    typeof candidate.userId === 'number' &&
    typeof candidate.pilotName === 'string' &&
    isNullableString(candidate.club) &&
    isNullableString(candidate.date)
  )
}

// Validated at the boundary, not cast: the body crossed a network hop, so a shape mismatch must
// be a handled failure for that takeoff, not a crash reading `.takeoff` off something else.
export function parseTakeoffRecentFlightsBody(value: unknown): TakeoffRecentFlightsSuccessBody | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!isNamedTakeoffRef(candidate.takeoff)) return null
  if (!Array.isArray(candidate.flights) || !candidate.flights.every(isTakeoffFlight)) return null
  return { takeoff: candidate.takeoff, flights: candidate.flights }
}
