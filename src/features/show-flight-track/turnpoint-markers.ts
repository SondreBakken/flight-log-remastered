import type { TrackPoint } from '@/lib/flightlog/types'
import { turnpointLetter } from './scoring-overlay'

// One rendered marker, carrying every letter that resolves to a badge-overlapping point (#78,
// #83). `letters` is the single source of truth for what a marker shows; there is no separate
// `label` field to keep in sync — the display label ('A', or a merged 'D/E') is derived via
// turnpointGroupLabel below.
export type TurnpointMarkerGroup = {
  point: TrackPoint
  letters: string[]
}

// The one place that owns the '/' separator between merged letters, so track-map.tsx and any
// test asserting on the rendered label go through the same code instead of re-deriving it.
export function turnpointGroupLabel(group: TurnpointMarkerGroup): string {
  return group.letters.join('/')
}

type Pixel = { x: number; y: number }

function pixelDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Grouped by projected screen distance, not by coordinate or index: track-984290's FAI triangle
// collides through a repeated index (D and E are both track_idx 1215, the same array element),
// track-985713's flat triangle collides through two DIFFERENT indices (A at track_idx 13, B at
// track_idx 14) that independently resolve to the identical lon/lat, and that same fixture's D/E
// pair (track_idx 353/354) never shares a coordinate at all — they sit ~9.4 m apart, close enough
// to overlap on screen at typical zoom but far enough that no coordinate-equality check would ever
// catch them (#83). Projecting through the caller-supplied `projectToPixel` rather than comparing
// lon/lat keeps this function pure and unit-testable without a live MapLibre map, and makes the
// grouping answer change with zoom the way the visual overlap it's modelling does: the same pair
// of points is many screen pixels apart at a close zoom and a few pixels apart zoomed out.
//
// Clustering is greedy and transitive in turnpoint order: a turnpoint joins the first existing
// group with ANY member within thresholdPx (inclusive — <=, so an exact-coordinate pair with
// thresholdPx 0 still merges, not just that group's anchor), so a chain like A-near-B, B-near-C
// merges all three into one badge even if A and C themselves are far apart —
// the same transitivity the old exact-coordinate grouping got for free from comparing a shared
// map key. A merged badge is anchored at its first member's own coordinates (not a centroid),
// matching the pre-#83 exact-equality behaviour: the badge sits exactly on a real turnpoint,
// never on an averaged position between them.
export function groupTurnpointMarkersByPixelDistance(
  turnpointIndices: number[],
  points: TrackPoint[],
  projectToPixel: (point: TrackPoint) => Pixel,
  thresholdPx: number,
): TurnpointMarkerGroup[] {
  const groups: Array<{ group: TurnpointMarkerGroup; pixels: Pixel[] }> = []

  turnpointIndices.forEach((index, position) => {
    // Unguarded: turnpointIndices are parse-validated to be in range for points before a
    // ScoringGeometry is ever constructed (see parse-track.ts's assertIndicesConsistent /
    // assertTriangleShapeConsistent), so an out-of-range index here would already mean a bug
    // upstream of this function, not a case for it to defend against.
    const point = points[index]
    const letter = turnpointLetter(position)
    const pixel = projectToPixel(point)

    const nearbyEntry = groups.find(({ pixels }) => pixels.some((existing) => pixelDistance(existing, pixel) <= thresholdPx))
    if (nearbyEntry) {
      nearbyEntry.group.letters.push(letter)
      nearbyEntry.pixels.push(pixel)
      return
    }

    groups.push({ group: { point, letters: [letter] }, pixels: [pixel] })
  })

  return groups.map(({ group }) => group)
}
