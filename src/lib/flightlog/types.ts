export type Pilot = {
  userId: number
  name: string
  country: string | null
  club: string | null
}

export type Flight = {
  tripId: number
  userId: number
  date: string
  country: string | null
  takeoff: string | null
  glider: string | null
  duration: string | null
  flightCount: number
  distanceKm: number | null
  openDistanceKm: number | null
  note: string | null
}

export type TrackPoint = {
  lon: number
  lat: number
  altitude: number
  secondsFromStart: number
}

export type TrackStats = {
  date: string | null
  startFinish: string | null
  duration: string | null
  maxAltitude: number | null
  minAltitude: number | null
  maxSpeed: string | null
  maxClimb: string | null
  minClimb: string | null
}

export type Track = {
  tripId: number
  points: TrackPoint[]
  stats: TrackStats
}

export type TrackIndexEntry = {
  tripId: number
  updatedAt: string
}

export type Country = {
  countryId: number
  name: string
}

export type Club = {
  clubId: number
  name: string
  flightCount: number
}

export type Region = {
  regionId: number
  name: string
  countryId: number
}

// Carries all 10 fields rqtid=11 returns (see docs/flightlog-api.md) rather than trimming —
// unlike rqtid=9/countries and rqtid=10/regions, rqtid=11 has no createdby/timestamp metadata
// cruft to strip in the first place; every field it returns is something a server-side
// consumer plausibly needs (lat/lon for a map, wind/altitude for filtering, region/subregion
// for grouping). #38 owns the client-payload question and can trim further from here.
export type Takeoff = {
  takeoffId: number
  name: string
  lat: number
  lon: number
  // Confirmed (Norway, 6012 rows): integer, range 0-255, 165 distinct values spread evenly
  // across that range — an 8-bit bitmask, not a single compass point (see docs/flightlog-api.md
  // for the full reasoning). The bit-to-direction mapping was not independently confirmed.
  wind: number
  countryId: number
  regionId: number
  subregionId: number
  altitude: number
  altitudeDiff: number
}

// Deliberately not the `Pilot` type: a search result carries no club (the a=114 response
// never renders one), and reusing `Pilot` with `club` hardcoded to `null` would claim
// knowledge ("this pilot has no club") the response never actually gives.
export type PilotSearchResult = {
  userId: number
  name: string
  country: string
}
