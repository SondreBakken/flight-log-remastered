import { XMLParser } from 'fast-xml-parser'
import { buildRecord } from '@/lib/records/build-record'
import { SCORING_KIND_LABELS } from './types'
import type {
  LineScoringGeometry,
  LineScoringGeometryKind,
  ScoringGeometry,
  ScoringGeometryKind,
  ScoringGeometryResult,
  Track,
  TrackPoint,
  TrackStatsResult,
  TriangleScoringGeometry,
  TriangleScoringGeometryKind,
} from './types'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (isRecord(value) && '#text' in value) return text(value['#text'])
  return null
}

function readNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

// The statistics block arrives as a fixed-width plain-text table inside a CDATA section, so
// each field is addressed by its `labelPattern` — escaped regex source, not a literal label —
// rather than by structure. Passing a label verbatim here would be wrong: an unescaped `(` in
// e.g. "Max. climb (10s/60s)" becomes a capture group, and `match?.[1]` would silently return
// that group's contents instead of the value. `labelPattern` accepts more than one pattern
// because GpsDump has worded these labels differently across export versions: measured,
// fixtures/track-233524.kml is GpsDump 4.36 and track-235690.kml is GpsDump 4.23 — both 2010-era
// GpsDump desktop builds — while the other five sampled fixtures are GpsDumpAndroid 2.8.67/
// 2.8.72, a different product line rather than a newer version of the same one. (The KML's own
// `Metadata/@src`/`@v` attributes record exactly this distinction and would be the natural key
// for variant detection if label-sniffing ever stops being enough; this parser ignores both
// today.) Every candidate is tried in order and the first match wins.
function readStatLine(block: string, labelPattern: string | string[]): string | null {
  for (const candidate of Array.isArray(labelPattern) ? labelPattern : [labelPattern]) {
    // [^\S\r\n]+, not \s+: the table is fixed-width, so a blank value column (label present,
    // nothing after it on that line) must fail to match here, not have \s+ cross the newline
    // and silently return the next line's label text as this field's "value" instead.
    const match = block.match(new RegExp(`^${candidate}[^\\S\\r\\n]+(.+)$`, 'm'))
    if (match?.[1]) return match[1].trim()
  }
  return null
}

// Older GpsDump exports (measured: track-233524.kml, track-235690.kml) pack both the max and
// min climb rate onto a single "Max/min climb rate" line instead of the two separate "Max./Min.
// climb (10s/60s)" lines the current format uses, with an interval suffix ("over 60s") trailing
// the numbers instead of being baked into the label. Split rather than matched twice. The
// suffix is optional (some values carry none) and a leading `+` is accepted alongside `-` on
// either number. Decimal-comma values are out of scope: no sampled fixture uses them, and
// handling them would mean locale-aware number parsing across this whole file, not just here.
function parseClimbRates(block: string): { maxClimb: string | null; minClimb: string | null } {
  const maxClimb = readStatLine(block, 'Max\\. climb \\(10s/60s\\)')
  const minClimb = readStatLine(block, 'Min\\. climb \\(10s/60s\\)')
  if (maxClimb !== null || minClimb !== null) return { maxClimb, minClimb }

  const combined = readStatLine(block, 'Max/min climb rate')
  const parts = combined?.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)\s*(.*)$/)
  if (!parts) return { maxClimb: null, minClimb: null }
  const [, max, min, rawSuffix] = parts
  const suffix = rawSuffix.trim()
  return { maxClimb: suffix ? `${max} ${suffix}` : max, minClimb: suffix ? `${min} ${suffix}` : min }
}

// The description CDATA carries the pilot's own free-text comment before the `<pre>` table
// (real markup — e.g. track-235690.kml's own description opens with "solberg med alf og kurt
// og litespeed s"). Scoping every stats read to the `<pre>` section is what stops that prose
// from being able to fabricate or override a label line the table itself never had. No `<pre>`
// at all collapses to an empty block, the same "nothing to read" shape parseStats already
// treats as unparseable below.
function extractStatsTable(description: string): string {
  return description.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] ?? ''
}

// `'unparseable'` (see TrackStatsResult's own doc comment, which also notes the "block missing
// entirely" case folded into it here) fires only when NONE of the known labels matched
// anything — all eight fields, not just the five flight-performance ones. Date, Start/finish
// and Duration are matched by the exact same label-recognition mechanism as the five
// performance fields and are equally strong evidence the block's wording was recognised:
// measured across every sampled export era, only the five performance labels have ever been
// renamed, never date/start-finish/duration. Gating on all eight is what stops a block whose
// date and duration DID resolve from being reported as fully unreadable — and its already-parsed
// fields thrown away — just because its performance labels use wording this parser hasn't seen
// yet. The inverse risk (a stats block that's genuinely, legitimately absent, misreported as
// 'unparseable' because nothing in it happens to match) is unproven: no sampled fixture has
// that shape, so it's accepted as a documented gap rather than guarded against speculatively.
function parseStats(block: string, tripId: number): TrackStatsResult {
  const height = readStatLine(block, ['Height \\(max/min\\)', 'Max\\./min\\. height'])?.match(
    /(-?\d+)\s*\/\s*(-?\d+)/,
  )
  const maxAltitude = readNumber(height?.[1])
  const minAltitude = readNumber(height?.[2])
  const maxSpeed = readStatLine(block, ['Max\\. speed \\(10s/60s\\)', 'Max\\. mean/top speed'])
  const { maxClimb, minClimb } = parseClimbRates(block)
  const date = readStatLine(block, 'Date')
  const startFinish = readStatLine(block, 'Start/finish')
  const duration = readStatLine(block, 'Duration')

  // Named so the set of fields that count as "recognised" is the definition, not a comment
  // above an eight-way conjunction.
  const recognisedFields = [date, startFinish, duration, maxAltitude, minAltitude, maxSpeed, maxClimb, minClimb]
  const nothingRecognised = recognisedFields.every((field) => field === null)
  if (nothingRecognised) {
    console.error(`[parseTrack] stats block for trip ${tripId} is unparseable: no known label matched`)
    return 'unparseable'
  }

  return { date, startFinish, duration, maxAltitude, minAltitude, maxSpeed, maxClimb, minClimb }
}

function parseCoordinates(raw: string): Array<[number, number, number]> {
  return raw
    .trim()
    .split(/\s+/)
    .map((triple) => triple.split(',').map(Number))
    .filter(
      (parts): parts is [number, number, number] =>
        parts.length === 3 && parts.every((part) => Number.isFinite(part)),
    )
}

function parseSeconds(raw: string | null): number[] {
  if (!raw) return []
  return raw.trim().split(/\s+/).map(Number).filter(Number.isFinite)
}

function toTrackPoints(
  coordinates: Array<[number, number, number]>,
  seconds: number[],
): TrackPoint[] {
  return coordinates.map(([lon, lat, altitude], index) => ({
    lon,
    lat,
    altitude,
    secondsFromStart: seconds[index] ?? index,
  }))
}

function findPlacemarkByType(placemarks: unknown[], type: string): Record<string, unknown> | null {
  const placemark = placemarks.find((placemark) => {
    if (!isRecord(placemark)) return false
    const metadata = placemark.Metadata
    return isRecord(metadata) && metadata['@_type'] === type
  })
  return isRecord(placemark) ? placemark : null
}

// Shared by readTrackIdx and readSeconds below: both live at the same Metadata → FsInfo
// depth, and neither cares about anything else on the placemark.
function readFsInfo(placemark: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = placemark.Metadata
  if (!isRecord(metadata)) return null
  const fsInfo = metadata.FsInfo
  return isRecord(fsInfo) ? fsInfo : null
}

function readTrackIdx(placemark: Record<string, unknown>): number[] | null {
  const fsInfo = readFsInfo(placemark)
  if (!fsInfo) return null
  const raw = fsInfo['@_track_idx']
  if (typeof raw !== 'string') return null
  const indices = raw.trim().split(/\s+/).map(Number)
  // Number.isFinite alone accepts "0 1.5 4": a fractional index that distinctPointCount
  // (and every point[index] lookup after it) would otherwise pass straight to, reading it as
  // an array position and getting `undefined`, then throwing an unrelated raw TypeError
  // several calls later instead of the caller-facing "no turnpoint indices" this function
  // already promises for markup it can't read.
  return indices.every(Number.isInteger) ? indices : null
}

// The scoring table's total is on a line like `                    Sum  12.56`, used by every
// scoring geometry except distance_open (which has only two points and so never sums
// anything — see parseOpenDistanceKm). "Sum" is a unique literal in this table, unlike a
// plain trailing-number scan, which would also match the DMS seconds a data row's own
// Latitude/Longitude columns happen to end in (see parseOpenDistanceKm's comment).
function parseSumDistanceKm(description: string): number | null {
  const match = description.match(/^\s*Sum\s+(-?\d+\.\d+)\s*$/m)
  return match ? Number.parseFloat(match[1]) : null
}

// distance_open's table has no Sum row — its one data row with a real distance value is the
// second (only the first-to-second-point distance exists to sum). A naive "last decimal
// number on the line" scan is not safe here: every row's Latitude/Longitude DMS columns also
// end in a decimal number (e.g. "N 61 42 25.77  E 009 27 48.05"), so a row with no Distance
// value at all would still look like it has one. Reading the fixed-width Distance column by
// its header offset (mirroring readStatLine's fixed-width read of the stats block above) is
// what tells "no distance printed here" apart from "the DMS seconds happen to look numeric."
function parseOpenDistanceKm(description: string): number | null {
  const header = description.match(/^Pos\..*Distance\s*$/m)?.[0]
  const rows = description.match(/^ [A-Z] .*$/gm)
  if (!header || !rows || rows.length === 0) return null

  const distanceColumn = header.indexOf('Distance')
  const lastRow = rows[rows.length - 1]
  const value = lastRow.slice(distanceColumn).trim()
  if (value === '') return null

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseScoringDistanceKm(kind: ScoringGeometryKind, description: string): number | null {
  return kind === 'distance_open' ? parseOpenDistanceKm(description) : parseSumDistanceKm(description)
}

// Counts the turnpoints that resolve to genuinely different points in the full track. A
// degenerate geometry (e.g. `track_idx="0 0 0 0 0"`) resolves every turnpoint to the same
// point, which is indistinguishable from a real geometry once rendered: a zero-length or
// single-point line. Comparing resolved indices' own coordinates (rather than trusting the
// index values to differ) is what catches that even if two DIFFERENT indices ever happened
// to land on an identical coordinate.
function distinctPointCount(indices: number[], points: TrackPoint[]): number {
  const seen = new Set(indices.map((index) => `${points[index].lon},${points[index].lat}`))
  return seen.size
}

// A description with no LineString, or vice versa, is never the known metadata-only stub
// shape (both absent together — see parseScoringGeometry) and never a real geometry either,
// so each throws rather than silently returning null. Two narrow assertions rather than one
// combined check: each narrows exactly the value it guards, so the caller reads both as plain
// non-null strings afterwards with no unions left to juggle.
function assertDescriptionPresent(
  description: string | null,
  kind: ScoringGeometryKind,
  tripId: number,
): asserts description is string {
  if (description === null) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a LineString without a description — neither a ` +
        'real geometry nor the known metadata-only stub shape',
    )
  }
}

function assertLineStringPresent(
  coordinatesRaw: string | null,
  kind: ScoringGeometryKind,
  tripId: number,
): asserts coordinatesRaw is string {
  if (coordinatesRaw === null) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a description without a LineString — neither a ` +
        'real geometry nor the known metadata-only stub shape',
    )
  }
}

// A `Record<TriangleScoringGeometryKind, true>`, not a `readonly TriangleScoringGeometryKind[]`
// cast through `as readonly string[]`: the array cast erases the union entirely, so adding a
// third triangle kind to the type without adding it here would compile clean and silently fall
// through to parseLineGeometry instead of failing the build. A Record keyed by the union itself
// makes TypeScript reject this object — not just isTriangleKind's callers — the moment a new
// member exists without an entry.
const TRIANGLE_KIND_LOOKUP: Record<TriangleScoringGeometryKind, true> = {
  distance_flat_triangle: true,
  distance_fai_triangle: true,
}

function isTriangleKind(kind: ScoringGeometryKind): kind is TriangleScoringGeometryKind {
  return kind in TRIANGLE_KIND_LOOKUP
}

// One name/track_idx/distance read, shared by both the line and triangle parse paths below —
// each throws the same way regardless of which shape the placemark turns out to be.
function readPlacemarkName(placemark: Record<string, unknown>, kind: ScoringGeometryKind, tripId: number): string {
  const name = text(placemark.name)
  if (!name) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no name`)
  return name
}

function readRequiredTrackIdx(placemark: Record<string, unknown>, kind: ScoringGeometryKind, tripId: number): number[] {
  const indices = readTrackIdx(placemark)
  if (!indices) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no turnpoint indices`)
  return indices
}

function readRequiredDistanceKm(kind: ScoringGeometryKind, description: string, tripId: number): number {
  const distanceKm = parseScoringDistanceKm(kind, description)
  if (distanceKm === null) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a distance its own table doesn't contain`)
  }
  return distanceKm
}

type TriangleRawCoordinates = {
  loop: Array<[number, number, number]>
  connector: Array<[number, number, number]>
}

// A real triangle's geometry is a MultiGeometry of exactly two LineString children — a closed
// loop and a connector (see TriangleScoringGeometry's own doc comment in types.ts) — never a
// single LineString the way the other five kinds are. Naively reading `placemark.LineString`
// for a triangle placemark would find nothing and misreport every real triangle as the
// metadata-only stub; this is what stops that. Returns null ONLY for the genuine stub shape —
// no MultiGeometry and no bare LineString at all (see the fixtures with only a bare `<name>`
// and no `<description>`/`<MultiGeometry>`), which the caller treats identically to the
// single-LineString kinds' "no LineString" case. Anything else — a bare LineString instead of
// MultiGeometry, a MultiGeometry with the wrong number of LineString children, or a child
// missing its own coordinates — is markup this parser recognises the PRESENCE of but not the
// shape of, so it throws instead of returning null. Returning null there would let it fold into
// the "no description either" branch above and misreport as the confirmed-absent stub, exactly
// the confident-wrong-null failure ScoringGeometryResult's own doc comment warns about; throwing
// keeps it on the 'unparseable' path regardless of whether a description happens to be present,
// matching the single-LineString kinds' assertLineStringPresent/assertDescriptionPresent
// behaviour for the same "something's there, it's just not what I expect" shape.
function extractTriangleCoordinates(
  placemark: Record<string, unknown>,
  kind: TriangleScoringGeometryKind,
  tripId: number,
): TriangleRawCoordinates | null {
  const multiGeometry = placemark.MultiGeometry
  if (!isRecord(multiGeometry)) {
    if (placemark.LineString !== undefined) {
      throw new Error(
        `Scoring placemark ${kind} for trip ${tripId} has a bare LineString instead of the MultiGeometry a ` +
          'triangle always has',
      )
    }
    return null
  }

  const lineStrings = toArray(multiGeometry.LineString)
  if (lineStrings.length !== 2) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a MultiGeometry with ${lineStrings.length} LineString ` +
        'children, not the 2 (loop, connector) a triangle always has',
    )
  }

  // Guards `undefined` as well as `null`: destructuring a `.map()` result shorter than 2 (were
  // the length check above ever relaxed or bypassed) yields `undefined` at a missing index, not
  // `null` — a `=== null`-only check would silently let that slip through as "no coordinates
  // text", not the "wrong number of children" shape it actually is.
  const [loopRaw, connectorRaw] = lineStrings.map((lineString) =>
    isRecord(lineString) ? text(lineString.coordinates) : null,
  )
  if (loopRaw == null || connectorRaw == null) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a MultiGeometry LineString child without coordinates`,
    )
  }

  return { loop: parseCoordinates(loopRaw), connector: parseCoordinates(connectorRaw) }
}

function assertTriangleGeometryPresent(
  coordinates: TriangleRawCoordinates | null,
  kind: TriangleScoringGeometryKind,
  tripId: number,
): asserts coordinates is TriangleRawCoordinates {
  if (coordinates === null) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a description without a MultiGeometry — neither a ` +
        'real geometry nor the known metadata-only stub shape',
    )
  }
}

// A triangle's own shape is fixed by definition, not reconciled against track_idx by a raw
// coordinate count the way assertIndicesConsistent does for the other five kinds: the loop is
// a closed 3-vertex ring (4 raw coordinates, first repeating last) and the connector is a
// straight 2-point segment, 6 raw coordinates in total, against 5 track_idx indices (A-E) —
// counts that never match and were never meant to. Two fixtures confirmed on real flightlog.org
// exports (track-984290, track-985713) additionally have only 4 DISTINCT coordinates because
// the connector shares an endpoint with the loop, without the raw shape itself being any less
// well-formed. What IS checked is the shape's own internal well-formedness — the loop closes on
// itself, the connector has exactly two ends, track_idx carries exactly the 5 letters a
// triangle's table always has, and every index resolves inside the track.
function assertTriangleShapeConsistent(
  indices: number[],
  coordinates: TriangleRawCoordinates,
  points: TrackPoint[],
  kind: TriangleScoringGeometryKind,
  tripId: number,
): void {
  if (coordinates.loop.length !== 4) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a triangle loop with ${coordinates.loop.length} ` +
        'points, not the expected closed 4-point ring',
    )
  }
  if (coordinates.connector.length !== 2) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a triangle connector with ${coordinates.connector.length} ` +
        'points, not the expected 2-point segment',
    )
  }
  const [firstLon, firstLat] = coordinates.loop[0]
  const [lastLon, lastLat] = coordinates.loop[3]
  if (firstLon !== lastLon || firstLat !== lastLat) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a triangle loop that does not close on itself`)
  }
  if (indices.length !== 5) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has ${indices.length} turnpoint indices, not the 5 a ` +
        "triangle's A-E table always has",
    )
  }
  if (indices.some((index) => index < 0 || index >= points.length)) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a turnpoint index outside the track`)
  }
}

// A track_idx whose length disagrees with its own LineString's coordinate count, or an index
// outside the track entirely, means this placemark's own turnpoint wiring doesn't add up —
// not a shape this parser has ever seen as legitimate, so it throws.
function assertIndicesConsistent(
  indices: number[],
  coordinates: Array<[number, number, number]>,
  points: TrackPoint[],
  kind: ScoringGeometryKind,
  tripId: number,
): void {
  if (coordinates.length !== indices.length) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has ${indices.length} turnpoint indices but ` +
        `${coordinates.length} coordinates`,
    )
  }
  if (indices.some((index) => index < 0 || index >= points.length)) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a turnpoint index outside the track`)
  }
}

// The five single-LineString kinds' own parse path: `placemark.LineString` plus `track_idx`,
// one index per coordinate, resolved directly into an ordered polyline. See
// parseTriangleGeometry below for why the two triangle kinds cannot reuse this path.
function parseLineGeometry(
  kind: LineScoringGeometryKind,
  placemark: Record<string, unknown>,
  points: TrackPoint[],
  tripId: number,
): LineScoringGeometry | null {
  const description = text(placemark.description)
  const lineString = placemark.LineString
  const coordinatesRaw = isRecord(lineString) ? text(lineString.coordinates) : null

  if (description === null && coordinatesRaw === null) return null
  assertDescriptionPresent(description, kind, tripId)
  assertLineStringPresent(coordinatesRaw, kind, tripId)

  const name = readPlacemarkName(placemark, kind, tripId)
  const indices = readRequiredTrackIdx(placemark, kind, tripId)

  const coordinates = parseCoordinates(coordinatesRaw)
  assertIndicesConsistent(indices, coordinates, points, kind, tripId)

  if (distinctPointCount(indices, points) < 2) return null

  const distanceKm = readRequiredDistanceKm(kind, description, tripId)

  return { shape: 'line', kind, name, distanceKm, turnpointIndices: indices }
}

// A triangle placemark's geometry lives under MultiGeometry (see extractTriangleCoordinates),
// not `placemark.LineString` — reading `.LineString` directly, the way parseLineGeometry does,
// would find nothing on every real triangle and misreport it as the metadata-only stub. The
// KML's own 5-letter turnpoint table (A-E) numbers A and E as the connector's two ends and
// B/C/D as the loop's three distinct vertices closing back onto B (confirmed against
// fixtures/track-233524.kml's own track_idx values resolved against its MultiGeometry
// coordinates) — that grouping is what loopIndices/connectorIndices below carry.
function parseTriangleGeometry(
  kind: TriangleScoringGeometryKind,
  placemark: Record<string, unknown>,
  points: TrackPoint[],
  tripId: number,
): TriangleScoringGeometry | null {
  const description = text(placemark.description)
  const triangleCoordinates = extractTriangleCoordinates(placemark, kind, tripId)

  if (description === null && triangleCoordinates === null) return null
  assertDescriptionPresent(description, kind, tripId)
  assertTriangleGeometryPresent(triangleCoordinates, kind, tripId)

  const name = readPlacemarkName(placemark, kind, tripId)
  const indices = readRequiredTrackIdx(placemark, kind, tripId)

  assertTriangleShapeConsistent(indices, triangleCoordinates, points, kind, tripId)

  const [connectorStart, loopB, loopC, loopD, connectorEnd] = indices
  const loopIndices: [number, number, number] = [loopB, loopC, loopD]
  const connectorIndices: [number, number] = [connectorStart, connectorEnd]

  // Two independent degeneracy checks, not one: the whole-geometry check below (same rule as
  // parseLineGeometry's) only catches every one of A-E collapsing to a single point. A loop
  // whose own B/C/D collapse to one point is degenerate on its own terms — a zero-area
  // triangle, nothing left to render as a closed 3-vertex ring — even when A and E (the
  // connector's own ends) are still genuinely distinct from it and from each other, which would
  // otherwise keep the whole-geometry count at 2 or more and let a zero-area "triangle" through.
  if (distinctPointCount(loopIndices, points) < 2) return null
  if (distinctPointCount(indices, points) < 2) return null

  const distanceKm = readRequiredDistanceKm(kind, description, tripId)

  return {
    shape: 'triangle',
    kind,
    name,
    distanceKm,
    turnpointIndices: indices,
    loopIndices,
    connectorIndices,
  }
}

// Resolves one scoring geometry, collapsing its three real absence shapes into one `null`
// ("not available"):
//   1. placemark missing entirely (`!placemark`)
//   2. placemark present as a metadata-only stub, no description and no geometry (both
//      absent together — confirmed for the two triangle kinds directly, see
//      fixtures/track-1001428.kml's own bare `<name>`-only triangle placemarks; unconfirmed
//      for the other five kinds specifically, since no sampled fixture surfaces it there)
//   3. placemark present with a genuine geometry, but every turnpoint resolves to the same
//      point (a degenerate, effectively zero-length line)
// Anything that looks like case 2 but isn't, or a distance the description's own table
// doesn't actually contain, throws instead of silently returning null — see
// assertDescriptionPresent/assertLineStringPresent/assertIndicesConsistent (the five
// single-LineString kinds) and assertTriangleGeometryPresent/assertTriangleShapeConsistent
// (the two triangle kinds) above. Silently returning `[]`/null for markup this parser doesn't
// recognise is the exact failure this repo has hit four times (#25, #6, #32, #8): a confident
// wrong "not available" that then caches. The caller (resolveScoringGeometry below) is what
// keeps that throw from taking the rest of the page down with it.
function parseScoringGeometry(
  kind: ScoringGeometryKind,
  placemarks: unknown[],
  points: TrackPoint[],
  tripId: number,
): ScoringGeometry | null {
  const placemark = findPlacemarkByType(placemarks, kind)
  if (!placemark) return null

  return isTriangleKind(kind)
    ? parseTriangleGeometry(kind, placemark, points, tripId)
    : parseLineGeometry(kind, placemark, points, tripId)
}

// Contains parseScoringGeometry's throw to this one geometry (#15's original blast-radius
// bug: six new throw sites inside parseTrack, which the flight page awaits directly with no
// error boundary below it, so one malformed OPTIONAL overlay used to blank the whole page —
// map, altitude gradient, barogram and stats included — behind a message that blames a fetch
// that actually succeeded). `console.error` is what keeps the failure loud (a server log
// entry, not a silent swallow) while `'unparseable'` is what keeps it from looking like the
// ordinary, confirmed-absent `null` case — see ScoringGeometryResult's own doc comment for
// why that distinction has to survive all the way to the UI.
function resolveScoringGeometry(
  kind: ScoringGeometryKind,
  placemarks: unknown[],
  points: TrackPoint[],
  tripId: number,
): ScoringGeometryResult {
  try {
    return parseScoringGeometry(kind, placemarks, points, tripId)
  } catch (error) {
    console.error(`[parseTrack] scoring geometry ${kind} for trip ${tripId} is unparseable`, error)
    return 'unparseable'
  }
}

function parseScoringGeometries(
  placemarks: unknown[],
  points: TrackPoint[],
  tripId: number,
): Record<ScoringGeometryKind, ScoringGeometryResult> {
  return buildRecord(SCORING_KIND_LABELS, (kind) => resolveScoringGeometry(kind, placemarks, points, tripId))
}

export function parseTrack(kml: string, tripId: number): Track {
  const document = parser.parse(kml) as Record<string, unknown>
  const folder = isRecord(document.Document) ? document.Document.Folder : undefined
  if (!isRecord(folder)) {
    throw new Error(`Tracklog for trip ${tripId} has no folder`)
  }

  const placemarks = toArray(folder.Placemark)
  const placemark = findPlacemarkByType(placemarks, 'track')
  if (!placemark) {
    throw new Error(`Tracklog for trip ${tripId} has no track placemark`)
  }

  const lineString = placemark.LineString
  const coordinates = isRecord(lineString) ? text(lineString.coordinates) : null
  if (!coordinates) {
    throw new Error(`Tracklog for trip ${tripId} has no coordinates`)
  }

  const points = toTrackPoints(parseCoordinates(coordinates), parseSeconds(readSeconds(placemark)))

  return {
    tripId,
    points,
    stats: parseStats(extractStatsTable(text(folder.description) ?? ''), tripId),
    scoring: parseScoringGeometries(placemarks, points, tripId),
  }
}

function readSeconds(placemark: Record<string, unknown>): string | null {
  const fsInfo = readFsInfo(placemark)
  return fsInfo ? text(fsInfo.SecondsFromTimeOfFirstPoint) : null
}
