import { XMLParser } from 'fast-xml-parser'
import { buildRecord } from '@/lib/records/build-record'
import { SCORING_KIND_LABELS } from './types'
import type {
  ScoringGeometry,
  ScoringGeometryKind,
  ScoringGeometryResult,
  Track,
  TrackPoint,
  TrackStatsResult,
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

// Resolves one scoring geometry, collapsing its three real absence shapes into one `null`
// ("not available"):
//   1. placemark missing entirely (`!placemark`)
//   2. placemark present as a metadata-only stub, no description and no LineString (both
//      absent together — the shape real triangle stubs actually have; unconfirmed for any
//      in-scope kind specifically, since SCORING_KIND_LABELS' five kinds never surface it in
//      a sampled fixture — borrowed from the triangle placemarks that do)
//   3. placemark present with a genuine geometry, but every turnpoint resolves to the same
//      point (a degenerate, effectively zero-length line)
// Anything that looks like case 2 but isn't, or a distance the description's own table
// doesn't actually contain, throws instead of silently returning null — see
// assertDescriptionPresent/assertLineStringPresent/assertIndicesConsistent above. Silently
// returning `[]`/null for markup this parser doesn't recognise is the exact failure this
// repo has hit four times (#25, #6, #32, #8): a confident wrong "not available" that then
// caches. The caller (resolveScoringGeometry below) is what keeps that throw from taking the
// rest of the page down with it.
function parseScoringGeometry(
  kind: ScoringGeometryKind,
  placemarks: unknown[],
  points: TrackPoint[],
  tripId: number,
): ScoringGeometry | null {
  const placemark = findPlacemarkByType(placemarks, kind)
  if (!placemark) return null

  const description = text(placemark.description)
  const lineString = placemark.LineString
  const coordinatesRaw = isRecord(lineString) ? text(lineString.coordinates) : null

  if (description === null && coordinatesRaw === null) return null
  assertDescriptionPresent(description, kind, tripId)
  assertLineStringPresent(coordinatesRaw, kind, tripId)

  const name = text(placemark.name)
  if (!name) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no name`)

  const indices = readTrackIdx(placemark)
  if (!indices) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no turnpoint indices`)

  const coordinates = parseCoordinates(coordinatesRaw)
  assertIndicesConsistent(indices, coordinates, points, kind, tripId)

  if (distinctPointCount(indices, points) < 2) return null

  const distanceKm = parseScoringDistanceKm(kind, description)
  if (distanceKm === null) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a distance its own table doesn't contain`)
  }

  return { kind, name, distanceKm, turnpointIndices: indices }
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
