import { existsSync, readFileSync } from 'node:fs'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import type { ScoringGeometryKind } from '../src/lib/flightlog/types'

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
    assert(track.scoring[kind] !== null, `track-1001428: ${kind} is available`)
  }
  const fivePoint = track.scoring.distance_5_point
  console.log(`track-1001428: distance_5_point=${JSON.stringify(fivePoint)}`)
  assert(fivePoint?.name === 'Distance over 5 points', 'track-1001428: distance_5_point uses the KML\'s own name verbatim')
  assert(fivePoint?.distanceKm === 52.76, `track-1001428: distance_5_point sums to 52.76 km (got ${fivePoint?.distanceKm})`)
  assert(
    JSON.stringify(fivePoint?.turnpointIndices) === JSON.stringify([2, 233, 2144, 2928, 6905]),
    `track-1001428: distance_5_point's turnpoint indices are exact (got ${JSON.stringify(fivePoint?.turnpointIndices)})`,
  )
  // The turnpoint index is free wiring into the same points array the track placemark uses
  // (#15's core finding) — its first turnpoint must resolve to that placemark's own first
  // scoring coordinate (9.463348 shape confirmed by hand against the raw KML), not some other
  // point nearby.
  const firstTurnpoint = fivePoint ? track.points[fivePoint.turnpointIndices[0]] : undefined
  assert(
    firstTurnpoint?.lon === 8.235283 && firstTurnpoint?.lat === 61.918517,
    `track-1001428: distance_5_point's first turnpoint index resolves to the placemark's own first coordinate (got ${JSON.stringify(firstTurnpoint)})`,
  )
}

// track-235690.kml: missing 3 placemarks entirely (out-and-return, both triangles). The
// four that remain must still parse; the missing one must collapse to null, not throw and
// not a fabricated empty line.
{
  const track = parseTrack(readFileSync('fixtures/track-235690.kml', 'utf8'), 235690)
  assert(track.scoring.distance_out_and_return === null, 'track-235690: missing out-and-return placemark resolves to null')
  for (const kind of ['distance_5_point', 'distance_4_point', 'distance_3_point', 'distance_open'] as const) {
    assert(track.scoring[kind] !== null, `track-235690: ${kind} is still available`)
  }
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
  assert(track.scoring.distance_3_point !== null, `${file}: distance_3_point (not degenerate) is still available`)
}

// The 3-point sum on a short flight (991729: KML Sum 2.25 km) legitimately disagrees with the
// distance flight-list pages would show for the same flight (1.3 km, taken from a different
// geometry) — the overlay's own scored distance must reflect the fixture's actual sum, not be
// silently coerced to match a number from elsewhere.
{
  const track = parseTrack(readFileSync('fixtures/track-991729.kml', 'utf8'), 991729)
  assert(
    track.scoring.distance_3_point?.distanceKm === 2.25,
    `track-991729: distance_3_point keeps its own 2.25 km sum (got ${track.scoring.distance_3_point?.distanceKm})`,
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
    assert(
      track.scoring.distance_open?.distanceKm === expectedKm,
      `${file}: distance_open sums to ${expectedKm} km (got ${track.scoring.distance_open?.distanceKm})`,
    )
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
