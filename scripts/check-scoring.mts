import { existsSync, readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import type { ScoringGeometry, ScoringGeometryKind, ScoringGeometryResult } from '../src/lib/flightlog/types'

// Same rationale as check-parsers.mts: these are gitignored scraped KML tracklogs, absent in
// a clean checkout or CI, so a missing fixture means "nothing to check here", not "broken".
// SKIP loudly (exit 0) rather than fail the gate; a fixture that IS present and wrong below
// still fails for real.
const requiredFixtures = [
  'fixtures/track-1001428.kml',
  'fixtures/track-233524.kml',
  'fixtures/track-235690.kml',
  'fixtures/track-991729.kml',
  'fixtures/track-883027.kml',
  'fixtures/track-742436.kml',
  'fixtures/track-795416.kml',
]
const missing = requiredFixtures.filter((f) => !existsSync(f))
if (missing.length > 0) {
  console.log(
    `SKIP - check:scoring: missing ${missing.join(', ')}\n` +
      'These are gitignored scraped KML tracklogs, not present in a clean checkout. ' +
      'Regenerate them locally per the README "Fixtures" section to actually exercise the ' +
      'scoring-overlay parser.',
  )
  process.exit(0)
}

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function isGeometry(state: ScoringGeometryResult): state is ScoringGeometry {
  return state !== null && state !== 'unparseable'
}

// Deliberately its own copy, not imported from parse-track.ts/scoring-overlay.ts: a check
// script asserting SCORING_KINDS-shaped behaviour must not import SCORING_KINDS itself — a
// bug or an accidental trim of that shared list would silently narrow what this script checks
// right along with it, instead of catching the drift.
const ALL_KINDS: ScoringGeometryKind[] = [
  'distance_5_point',
  'distance_4_point',
  'distance_3_point',
  'distance_open',
  'distance_out_and_return',
]

// track-1001428.kml: the full-set fixture — every one of the five in-scope geometries is a
// real, present, non-degenerate placemark.
{
  const track = parseTrack(readFileSync('fixtures/track-1001428.kml', 'utf8'), 1001428)
  for (const kind of ALL_KINDS) {
    assert(isGeometry(track.scoring[kind]), `track-1001428: ${kind} is available`)
  }
  const fivePoint = track.scoring.distance_5_point
  console.log(`track-1001428: distance_5_point=${JSON.stringify(fivePoint)}`)
  assert(
    isGeometry(fivePoint) && fivePoint.name === 'Distance over 5 points',
    "track-1001428: distance_5_point uses the KML's own name verbatim",
  )
  assert(
    isGeometry(fivePoint) && fivePoint.distanceKm === 52.76,
    `track-1001428: distance_5_point sums to 52.76 km (got ${isGeometry(fivePoint) ? fivePoint.distanceKm : fivePoint})`,
  )
  assert(
    isGeometry(fivePoint) && JSON.stringify(fivePoint.turnpointIndices) === JSON.stringify([2, 233, 2144, 2928, 6905]),
    `track-1001428: distance_5_point's turnpoint indices are exact (got ${isGeometry(fivePoint) ? JSON.stringify(fivePoint.turnpointIndices) : fivePoint})`,
  )
  // Not one of #58's 12 real-triangle fixtures — both triangle placemarks here are the
  // metadata-only stub (bare <name>, no <description>/<MultiGeometry>), so "full-set" above
  // deliberately stops at the original five kinds and this asserts the stub resolves to null
  // rather than silently being skipped.
  assert(track.scoring.distance_flat_triangle === null, 'track-1001428: stub distance_flat_triangle resolves to null')
  assert(track.scoring.distance_fai_triangle === null, 'track-1001428: stub distance_fai_triangle resolves to null')
}

// track-235690.kml: missing 3 placemarks entirely (out-and-return, both triangles). The
// four that remain must still parse; the missing one must collapse to null, not throw and
// not a fabricated empty line.
{
  const track = parseTrack(readFileSync('fixtures/track-235690.kml', 'utf8'), 235690)
  assert(track.scoring.distance_out_and_return === null, 'track-235690: missing out-and-return placemark resolves to null')
  assert(track.scoring.distance_flat_triangle === null, 'track-235690: missing distance_flat_triangle placemark resolves to null')
  assert(track.scoring.distance_fai_triangle === null, 'track-235690: missing distance_fai_triangle placemark resolves to null')
  for (const kind of ['distance_5_point', 'distance_4_point', 'distance_3_point', 'distance_open'] as const) {
    assert(isGeometry(track.scoring[kind]), `track-235690: ${kind} is still available`)
  }
}

// track-233524.kml: #58's MultiGeometry triangle shape (a closed 3-vertex loop plus a 2-point
// connector), values pinned against the fixture's own <FsInfo track_idx> and MultiGeometry
// coordinates read directly (see #58's implementation notes) rather than trusted from the
// parser under test.
{
  const track = parseTrack(readFileSync('fixtures/track-233524.kml', 'utf8'), 233524)
  const flatTriangle = track.scoring.distance_flat_triangle
  console.log(`track-233524: distance_flat_triangle=${JSON.stringify(flatTriangle)}`)
  assert(
    isGeometry(flatTriangle) &&
      flatTriangle.shape === 'triangle' &&
      flatTriangle.name === 'Flat triangle' &&
      flatTriangle.distanceKm === 2.26 &&
      JSON.stringify(flatTriangle.turnpointIndices) === JSON.stringify([15, 65, 78, 89, 90]) &&
      JSON.stringify(flatTriangle.loopIndices) === JSON.stringify([65, 78, 89]) &&
      JSON.stringify(flatTriangle.connectorIndices) === JSON.stringify([15, 90]),
    'track-233524: distance_flat_triangle parses with exact turnpoint/loop/connector indices and its own 2.26 km sum',
  )

  const faiTriangle = track.scoring.distance_fai_triangle
  console.log(`track-233524: distance_fai_triangle=${JSON.stringify(faiTriangle)}`)
  assert(
    isGeometry(faiTriangle) &&
      faiTriangle.shape === 'triangle' &&
      faiTriangle.name === 'FAI triangle' &&
      faiTriangle.distanceKm === 1.94 &&
      JSON.stringify(faiTriangle.turnpointIndices) === JSON.stringify([77, 78, 80, 91, 93]) &&
      JSON.stringify(faiTriangle.loopIndices) === JSON.stringify([78, 80, 91]) &&
      JSON.stringify(faiTriangle.connectorIndices) === JSON.stringify([77, 93]),
    'track-233524: distance_fai_triangle parses with exact turnpoint/loop/connector indices and its own 1.94 km sum',
  )
}

// track-991729.kml and track-883027.kml: short flights where the 5- and 4-point geometries
// are degenerate (track_idx repeats a single index, every turnpoint the same point) — a real
// KML shape, not a parser bug. Both must collapse to null, and the KML's own 5-point Sum
// of 0.00 must never surface as a real (zero) distance.
for (const [file, tripId] of [
  ['fixtures/track-991729.kml', 991729],
  ['fixtures/track-883027.kml', 883027],
] as const) {
  const track = parseTrack(readFileSync(file, 'utf8'), tripId)
  assert(track.scoring.distance_5_point === null, `${file}: degenerate distance_5_point resolves to null, not a zero-length line`)
  assert(track.scoring.distance_4_point === null, `${file}: degenerate distance_4_point resolves to null, not a zero-length line`)
  assert(isGeometry(track.scoring.distance_3_point), `${file}: distance_3_point (not degenerate) is still available`)
}

// The 3-point sum on a short flight (991729: KML Sum 2.25 km) legitimately disagrees with the
// distance flight-list pages would show for the same flight (1.3 km, taken from a different
// geometry) — the overlay's own scored distance must reflect the fixture's actual sum, not be
// silently coerced to match a number from elsewhere.
{
  const track = parseTrack(readFileSync('fixtures/track-991729.kml', 'utf8'), 991729)
  const threePoint = track.scoring.distance_3_point
  assert(
    isGeometry(threePoint) && threePoint.distanceKm === 2.25,
    `track-991729: distance_3_point keeps its own 2.25 km sum (got ${isGeometry(threePoint) ? threePoint.distanceKm : threePoint})`,
  )
}

// distance_open has no "Sum" row in its own table (only two points), so it is parsed by a
// different path (fixed-width column read) than the other four (regex on the "Sum" line).
// Pinning it against three fixtures' real values is what proves that path independently,
// rather than trusting it because the Sum-based path already passed above.
{
  const known: Array<[string, number, number]> = [
    ['fixtures/track-233524.kml', 233524, 10.55],
    ['fixtures/track-742436.kml', 742436, 64.69],
    ['fixtures/track-795416.kml', 795416, 62.91],
  ]
  for (const [file, tripId, expectedKm] of known) {
    const track = parseTrack(readFileSync(file, 'utf8'), tripId)
    const openDistance = track.scoring.distance_open
    assert(
      isGeometry(openDistance) && openDistance.distanceKm === expectedKm,
      `${file}: distance_open sums to ${expectedKm} km (got ${isGeometry(openDistance) ? openDistance.distanceKm : openDistance})`,
    )
  }
}

// #15's core finding, made comprehensive and value-based rather than position-based: every
// non-null geometry's turnpoint indices, resolved against the real track, must reproduce the
// exact same points its OWN <coordinates> lists — the actual claim "the turnpoint index is
// free wiring into the track's own points array" makes. A narrower, earlier version of this
// pinned only the FIRST turnpoint of ONE geometry against two literal numbers; points 0-6 of
// track-1001428 are byte-identical (the pilot stationary on takeoff), so any index in 0-6
// satisfied it, including a live off-by-one shifting every index by +1. Checking every
// turnpoint, of every available geometry, of every fixture, against values read fresh from
// the placemark's own coordinates — not a hand-copied literal — is what a shifted index
// actually has to disagree with.
//
// The re-extraction below is deliberately independent of parse-track.ts's own coordinate
// handling (a fresh regex-free XML parse, done here, of the same raw KML text) — this check
// exists specifically to catch that file's own index-resolution bugs, so it cannot trust that
// file's own account of what a placemark's coordinates are.
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function ownTextValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (isRecord(value) && '#text' in value) return ownTextValue(value['#text'])
  return null
}

// The placemark's own <coordinates>, in the order the KML itself lists them — not the order
// its own track_idx resolves to, which is exactly the thing being cross-checked below.
function ownCoordinates(kml: string, kind: ScoringGeometryKind): Array<[number, number]> | null {
  const document = xmlParser.parse(kml) as Record<string, unknown>
  const folder = isRecord(document.Document) ? document.Document.Folder : undefined
  const placemarks = isRecord(folder) ? toArray(folder.Placemark) : []
  const placemark = placemarks.find(
    (p) => isRecord(p) && isRecord(p.Metadata) && p.Metadata['@_type'] === kind,
  )
  if (!isRecord(placemark) || !isRecord(placemark.LineString)) return null
  const raw = ownTextValue(placemark.LineString.coordinates)
  if (!raw) return null
  return raw
    .trim()
    .split(/\s+/)
    .map((triple) => {
      const [lon, lat] = triple.split(',').map(Number)
      return [lon, lat] as [number, number]
    })
}

// Rotation-tolerant, not permutation-tolerant: track-233524's own distance_out_and_return
// placemark lists its <coordinates> starting one turnpoint later than its own track_idx does
// (confirmed against the description table's Pos. column and each row's DMS lat/lon —
// track_idx is the correct order, the LineString is simply rotated relative to it) — a real,
// benign KML shape on flightlog.org's own server, not a parser bug. Tolerating an arbitrary
// permutation instead would also let a genuine off-by-one slip through if it happened to
// reproduce the same SET of points; a rotation is far narrower than that, and the +1 mutation
// below is what proves it still is.
function isRotationOfOwnCoordinates(resolved: Array<[number, number]>, own: Array<[number, number]>): boolean {
  if (resolved.length !== own.length) return false
  const n = resolved.length
  const EPSILON = 1e-6
  const closeEnough = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON
  for (let rotation = 0; rotation < n; rotation++) {
    if (resolved.every((point, i) => closeEnough(point, own[(i + rotation) % n]))) return true
  }
  return false
}

for (const file of requiredFixtures) {
  const tripId = Number(file.match(/(\d+)/)?.[1])
  const kml = readFileSync(file, 'utf8')
  const track = parseTrack(kml, tripId)
  for (const kind of ALL_KINDS) {
    const geometry = track.scoring[kind]
    if (!isGeometry(geometry)) continue
    const resolved = geometry.turnpointIndices.map((index): [number, number] => [
      track.points[index].lon,
      track.points[index].lat,
    ])
    const own = ownCoordinates(kml, kind)
    assert(
      own !== null && isRotationOfOwnCoordinates(resolved, own),
      `${file}: ${kind}'s turnpoint indices resolve (up to rotation) to the placemark's own coordinates`,
    )
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
