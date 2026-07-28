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
  // Confirmed (Norway, 6012 rows): integer, range 0-255, 166 distinct values, heavily skewed
  // rather than evenly spread (3017/6012 rows fall in 0-31 alone; 0 is 991 rows, 255 is 366; 90
  // of the 256 possible values never appear) — an 8-bit bitmask, not a single compass point (see
  // docs/flightlog-api.md for the full reasoning). Bit-to-direction mapping pinned in #43 — use
  // decodeWindDirections/windIncludesDirection from ./wind, don't re-derive it here.
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

// a=22's "Siterecord" row: the best PG, HG and HG2 distance ever flown from this takeoff.
// Its link carries a `trip_id` but no `user_id` (unlike a=42's flight rows), so a pilot name
// here is text, not a follow target — see parse-takeoff-detail.ts's own doc comment.
export type SiteRecordClass = 'PG' | 'HG' | 'HG2'

export type SiteRecord = {
  recordClass: SiteRecordClass
  pilotName: string
  distanceKm: number
  tripId: number
}

// #11's takeoff detail page, from `a=22&country_id=N&start_id=M`. `description` is upstream
// free HTML rendered as plain text (see parse-takeoff-detail.ts for why), `region`/`altitude`/
// `linkUrl`/`createdAt`/`updatedAt` are all optional — flightlog.org renders each of them only
// when the takeoff record actually has a value, and `createdAt` in particular carries a
// `0000-00-00 00:00:00` placeholder for "never recorded", normalised to null here rather than
// rendered as a fake date.
export type TakeoffDetail = {
  takeoffId: number
  name: string
  region: string | null
  altitude: string | null
  description: string | null
  linkUrl: string | null
  createdAt: string | null
  updatedAt: string | null
  siteRecords: SiteRecord[]
}

// A single row from a=42 (flights at a takeoff), current year only — see takeoff-flights.ts
// for why this app never chases `a=42`'s own year/offset pagination further. `date` and
// `timeOfDay` are both carried even though #11's own field list only calls out "time of day":
// the table groups flights under a date header per day, so dropping the date here would make
// a whole year's worth of flights unreadable as anything but a flat list of times.
export type TakeoffFlight = {
  tripId: number
  userId: number
  pilotName: string
  club: string | null
  glider: string | null
  duration: string | null
  distanceKm: number | null
  note: string | null
  date: string | null
  timeOfDay: string | null
}
