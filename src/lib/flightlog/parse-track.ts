import { XMLParser } from 'fast-xml-parser'
import type { ScoringGeometry, ScoringGeometryKind, Track, TrackPoint, TrackStats } from './types'

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

// The statistics block arrives as a fixed-width plain-text table inside a CDATA section,
// so each field is addressed by its label rather than by structure.
function readStatLine(block: string, label: string): string | null {
  const match = block.match(new RegExp(`^${label}\\s+(.+)$`, 'm'))
  return match?.[1]?.trim() ?? null
}

function parseStats(block: string): TrackStats {
  const height = readStatLine(block, 'Height \\(max/min\\)')?.match(/(-?\d+)\s*\/\s*(-?\d+)/)

  return {
    date: readStatLine(block, 'Date'),
    startFinish: readStatLine(block, 'Start/finish'),
    duration: readStatLine(block, 'Duration'),
    maxAltitude: readNumber(height?.[1]),
    minAltitude: readNumber(height?.[2]),
    maxSpeed: readStatLine(block, 'Max\\. speed \\(10s/60s\\)'),
    maxClimb: readStatLine(block, 'Max\\. climb \\(10s/60s\\)'),
    minClimb: readStatLine(block, 'Min\\. climb \\(10s/60s\\)'),
  }
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

// The five in-scope single-LineString scoring geometries (#15). `distance_flat_triangle`/
// `distance_fai_triangle` are deliberately absent: they're MultiGeometry with a different
// turnpoint correspondence and out of scope (#58) — this list is also what a stub or
// degenerate triangle placemark (both real shapes on the live site) never gets near, since
// nothing here ever looks it up by that type.
const SCORING_KINDS: ScoringGeometryKind[] = [
  'distance_5_point',
  'distance_4_point',
  'distance_3_point',
  'distance_open',
  'distance_out_and_return',
]

function readTrackIdx(placemark: Record<string, unknown>): number[] | null {
  const metadata = placemark.Metadata
  if (!isRecord(metadata)) return null
  const fsInfo = metadata.FsInfo
  if (!isRecord(fsInfo)) return null
  const raw = fsInfo['@_track_idx']
  if (typeof raw !== 'string') return null
  const indices = raw.trim().split(/\s+/).map(Number)
  return indices.every(Number.isFinite) ? indices : null
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

// Resolves one scoring geometry, collapsing its three real absence shapes into one `null`
// ("not available"):
//   1. placemark missing entirely (`!placemark`)
//   2. placemark present as a metadata-only stub, no description and no LineString (both
//      absent together — the shape real triangle stubs actually have)
//   3. placemark present with a genuine geometry, but every turnpoint resolves to the same
//      point (a degenerate, effectively zero-length line)
// Anything that looks like case 2 but isn't — a description with no LineString, or vice
// versa, or a track_idx whose length disagrees with its own LineString's coordinate count, or
// an index outside the track, or a distance the description's own table doesn't actually
// contain — throws instead of silently returning null. Silently returning `[]`/null for
// markup this parser doesn't recognise is the exact failure this repo has hit four times
// (#25, #6, #32, #8): a confident wrong "not available" that then caches.
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
  if (description === null || coordinatesRaw === null) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has a description without a LineString, or vice ` +
        `versa (description=${description !== null}, LineString=${coordinatesRaw !== null}) — neither a ` +
        'real geometry nor the known metadata-only stub shape',
    )
  }

  const name = text(placemark.name)
  if (!name) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no name`)

  const indices = readTrackIdx(placemark)
  if (!indices) throw new Error(`Scoring placemark ${kind} for trip ${tripId} has no turnpoint indices`)

  const coordinates = parseCoordinates(coordinatesRaw)
  if (coordinates.length !== indices.length) {
    throw new Error(
      `Scoring placemark ${kind} for trip ${tripId} has ${indices.length} turnpoint indices but ` +
        `${coordinates.length} coordinates`,
    )
  }

  if (indices.some((index) => index < 0 || index >= points.length)) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a turnpoint index outside the track`)
  }

  if (distinctPointCount(indices, points) < 2) return null

  const distanceKm = parseScoringDistanceKm(kind, description)
  if (distanceKm === null) {
    throw new Error(`Scoring placemark ${kind} for trip ${tripId} has a distance its own table doesn't contain`)
  }

  return { kind, name, distanceKm, turnpointIndices: indices }
}

function parseScoringGeometries(
  placemarks: unknown[],
  points: TrackPoint[],
  tripId: number,
): Record<ScoringGeometryKind, ScoringGeometry | null> {
  return Object.fromEntries(
    SCORING_KINDS.map((kind) => [kind, parseScoringGeometry(kind, placemarks, points, tripId)]),
  ) as Record<ScoringGeometryKind, ScoringGeometry | null>
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
    stats: parseStats(text(folder.description) ?? ''),
    scoring: parseScoringGeometries(placemarks, points, tripId),
  }
}

function readSeconds(placemark: Record<string, unknown>): string | null {
  const metadata = placemark.Metadata
  if (!isRecord(metadata)) return null
  const fsInfo = metadata.FsInfo
  if (!isRecord(fsInfo)) return null
  return text(fsInfo.SecondsFromTimeOfFirstPoint)
}
