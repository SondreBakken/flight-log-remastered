export type Pilot = {
  userId: number
  name: string
  country: string | null
  club: string | null
}

// A pilot's own id, shared by every store or route that validates one — follow-store (who is
// followed), watermark-store (whose flights have been seen), and the recent-flights route
// (the :userId path param). None of those own this primitive; it is a flightlog.org identifier
// like `Pilot.userId` above, so it lives beside it rather than in whichever store happened to
// need it first.
export type PilotId = Pilot['userId']

// isSafeInteger, not isInteger: values past 2^53 (e.g. from `1e308` or an over-precision
// literal in stored JSON) still pass isInteger after float coercion but are not real ids.
export function isValidPilotId(value: unknown): value is PilotId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// A row from a=28's pilot logbook. flightlog.org aggregates same-day, same-glider flights
// into a single row (rendered `"00:10/ 2"`) — when `flightCount > 1`, `duration` is the GROUP
// TOTAL across those flights, not a per-flight duration (#68, measured against rqtid=1's
// independently labelled "Time (hours)" column: pilot 12677's own logbook has four rows, two
// of them aggregated, totalling ten flights across 51 minutes, and that sum matches the column
// exactly). flightlog.org publishes no per-flight breakdown for an aggregated row, so there is
// no honest per-flight duration to compute here — see format-flight.ts's formatFlightDuration
// for how this renders without implying one.
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

// Total distance (its own labeled line in the two 2010-era GpsDump fixtures, track-233524.kml
// and track-235690.kml) is read nowhere in this file — the newer GpsDumpAndroid format has no
// equivalent line to reconcile it against, so it stays unparsed rather than added as a field
// only the older fixtures could ever populate.
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

// A stats-block parse outcome, one of two states — deliberately not three. ScoringGeometryResult
// (below) needs `null` because a flight can genuinely lack a given scoring geometry. The stats
// block is different: every fixture sampled (see parse-track.ts's parseStats, both current-format
// and 2010-era GpsDump exports) carries one, so there is no observed "this flight legitimately has
// no statistics" case to keep distinct from "unreadable" — only parsed vs `'unparseable'` (markup
// present but none of the known label variants matched it, or the block was empty/missing
// entirely; both collapse to the same "nothing to show, and it's not because the flight has
// nothing" signal). Note this folds a genuinely distinct third case — "the block is missing
// entirely" vs. "the block is present but this exporter's wording isn't recognised" — into one
// signal; kept collapsed rather than split into its own state because no sampled fixture has
// ever shown the "missing entirely" shape to actually confirm it needs distinguishing. See
// parse-track.test.ts and scripts/check-parsers.mts for what's pinned.
export type TrackStatsResult = TrackStats | 'unparseable'

// The five single-LineString scoring geometries flightlog.org computes from a track, keyed
// by the KML's own `Metadata/@type` value (see parse-track.ts). Triangles (`distance_flat_
// triangle`/`distance_fai_triangle`) are deliberately excluded: they're MultiGeometry with a
// different turnpoint correspondence and are out of scope (#58).
export type ScoringGeometryKind =
  | 'distance_5_point'
  | 'distance_4_point'
  | 'distance_3_point'
  | 'distance_open'
  | 'distance_out_and_return'

// The KML's own English `<name>` value for each kind, verbatim (measured against every
// sampled fixture) — used as a fallback label for a geometry a flight doesn't have (see
// scoring-overlay.ts's scoringLabel). Also the single exhaustive source everything else
// keyed by `ScoringGeometryKind` derives from: `Record<ScoringGeometryKind, string>` forces
// TypeScript to reject this object if a kind is ever added to the union without an entry
// here, so `SCORING_KINDS` below (and parse-track.ts's own key enumeration) can never drift
// out of sync with the type — there is exactly one place left to update, not several.
export const SCORING_KIND_LABELS: Record<ScoringGeometryKind, string> = {
  distance_5_point: 'Distance over 5 points',
  distance_4_point: 'Distance over 4 points',
  distance_3_point: 'Distance over 3 points',
  distance_open: 'Open distance',
  distance_out_and_return: 'Out-and-return distance',
}

// Display/parse order: the order flightlog.org's own KML lists the geometries in (see every
// fixtures/track-*.kml), not alphabetical or by distance — preserved here because object key
// order is insertion order for string keys, and SCORING_KIND_LABELS above is already written
// in that same order.
export const SCORING_KINDS: ScoringGeometryKind[] = Object.keys(SCORING_KIND_LABELS) as ScoringGeometryKind[]

// `name` is the KML's own English `<name>` value, used verbatim rather than a name invented
// here. `turnpointIndices` are 0-based indices into this same track's `points` array (see
// `<FsInfo track_idx>` in parse-track.ts) — not a separate coordinate list — which is what
// lets a turnpoint reuse the map/barogram hover identity #14 built (see
// show-flight-track/track-hover.ts) instead of needing its own proximity matching.
export type ScoringGeometry = {
  kind: ScoringGeometryKind
  name: string
  distanceKm: number
  turnpointIndices: number[]
}

// A geometry's parse outcome, one of three states — never just two:
//   - `ScoringGeometry`: parsed successfully.
//   - `null`: confirmed absent (placemark missing, a metadata-only stub, or degenerate/
//     zero-length) — a flight that genuinely has no out-and-return, say.
//   - `'unparseable'`: scoring markup this parser doesn't recognise. Distinguishable from
//     `null` on purpose — collapsing this into `null` would make a parser bug that mangles
//     unfamiliar markup look identical to a flight that legitimately lacks the geometry, the
//     exact confident-wrong-"not available" failure this repo has shipped five times (#25,
//     #6, #32, #8, and — before this type existed — an earlier version of this branch, which
//     threw `parseTrack` itself over exactly this instead of containing it). See
//     parse-track.ts's parseScoringGeometries.
export type ScoringGeometryResult = ScoringGeometry | null | 'unparseable'

export type Track = {
  tripId: number
  points: TrackPoint[]
  stats: TrackStatsResult
  scoring: Record<ScoringGeometryKind, ScoringGeometryResult>
}

export type TrackIndexEntry = {
  tripId: number
  updatedAt: string
}

export type Country = {
  countryId: number
  name: string
}

// From `a=25` (see docs/flightlog-api.md): despite the column heading flightlog.org itself
// renders and despite this app's own earlier misreading of it (#66), the second `<td>` is the
// club's MEMBER count, not a flight count — confirmed against `a=26`'s own explicit `Members`
// field and that page's roster row count, both of which match this number exactly for every
// club sampled (Voss: 1271/1271/1271, Oslo: 677/677/677). No cheap source of a genuine
// per-club flight total exists anywhere already fetched; `rqtid=1` sums to one (Voss: 10309),
// but only via a second, per-club request this app's country page — up to 91 clubs for Norway
// alone — deliberately does not make (see getClubs's own doc comment and #4/#29).
export type Club = {
  clubId: number
  name: string
  memberCount: number
}

// From `a=26` (see docs/flightlog-api.md): every field the club-detail info table renders,
// each one optional except `memberCount` — "Link to more info" and "Coordinates" are each
// confirmed absent on at least one real club (Oslo has no Coordinates row at all; a club with
// no external site has no "Link to more info" row) — see parse-club-detail.ts. `description`
// is optional here for type-shape consistency with the others (its own value can be `null`
// after multi-line normalisation), but `Description` itself is one of parse-club-detail.ts's
// REQUIRED_LABELS: it is present on every sampled fixture, including the zero-member one, and
// the parser throws rather than returning a club without it. `name` comes from the page's own
// breadcrumb, not a labelled row.
export type ClubDetail = {
  clubId: number
  name: string
  memberCount: number
  coordinatesText: string | null
  mapUrl: string | null
  description: string | null
  linkUrl: string | null
  createdAt: string | null
  updatedAt: string | null
}

// A row from `a=26`'s own member roster table (same page as ClubDetail above, not a second
// fetch) — the only source in this app that ties a club member to a `user_id`. See
// parse-club-roster.ts.
export type ClubMember = {
  userId: number
  name: string
}

// A row from `rqtid=1`'s per-pilot stats table — name only, no `user_id` (see
// docs/flightlog-api.md's "THE JOIN" reasoning: flightlog.org itself has no reliable way to
// key this by pilot, only by display name). Resolving a row to a `ClubMember.userId` is a
// separate, explicit step (see resolve-stats-pilots.ts) — never done inside this type or its
// parser, so "unresolved" stays a visible state rather than something a parser could
// silently paper over.
export type ClubPilotStats = {
  name: string
  flights: number
  distanceKm: number
  hours: number
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
