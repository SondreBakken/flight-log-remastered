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

// A cheap identity for "did the grouping actually change" between two renders — just the label
// sequence, not each group's own anchor coordinate too: the label sequence alone already fully
// determines the grouping (letters are assigned in turnpoint order and never reused across
// groups, so two groups can never share a label the way they could share an unrelated anchor),
// so a second coordinate half would only ever agree or disagree in lockstep with the labels, never
// catch a change the labels missed. track-map.tsx's zoom/pan/pitch listener calls this on every
// re-derived grouping and skips tearing down and re-adding markers when it comes back unchanged.
export function turnpointGroupsSignature(groups: TurnpointMarkerGroup[]): string {
  return groups.map(turnpointGroupLabel).join('|')
}

type Pixel = { x: number; y: number }

function pixelDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// The clustering loop's own working state for one group: its rendered shape (TurnpointMarkerGroup)
// plus every member's pixel position, kept alongside it only so the next turnpoint can be tested
// against all of them — the final return value below strips this back down to just the groups.
type ClusterInProgress = { group: TurnpointMarkerGroup; pixels: Pixel[] }

function hasMemberWithin(cluster: ClusterInProgress, pixel: Pixel, thresholdPx: number): boolean {
  return cluster.pixels.some((existing) => pixelDistance(existing, pixel) <= thresholdPx)
}

// The badge is a 20x20 circle (see track-map.tsx's own createTurnpointElement, `h-5`/`min-w-5`),
// so two badge centers less than 20px apart on screen already overlap — that diameter is the
// natural pixel-distance threshold for grouping two turnpoints into one badge (#83). Owned here,
// not in track-map.tsx: this module is what actually applies it, and the unit tests need the
// same number the production call site uses rather than a second copy of it.
export const TURNPOINT_GROUPING_THRESHOLD_PX = 20

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
// Clustering is a single greedy pass in turnpoint order, and it is ORDER-DEPENDENT, not
// transitive across the whole set: a turnpoint joins the first existing group with ANY member
// within thresholdPx (inclusive — <=, so an exact-coordinate pair with thresholdPx 0 still
// merges), so a chain like A-near-B, B-near-C merges all three into one badge when visited in
// that order, but the same three points visited as A-near-C, B (x = 0, 30, 15 at threshold 20)
// yield ['A/C', 'B'] instead — A and C merge on sight, then B never gets a chance to test itself
// against C because A's group already absorbed it. This never merges two groups that already
// exist; it only ever tests a new point against groups formed so far. That is safe here because
// turnpoint order is fixed per flight (flightlog.org's own A-E sequence), so the same flight
// always produces the same grouping — the algorithm is deterministic, just not
// order-independent the way true transitive clustering would be.
//
// The invariant this DOES guarantee, and the one verify-scoring.mts's rect-intersection oracle
// actually relies on: a new group is only ever created when its point is more than thresholdPx
// from every existing group's every member, so once clustering finishes, every group's anchor is
// pairwise more than thresholdPx from every other group's anchor. No two rendered badges can
// therefore ever sit close enough on screen to visually overlap.
export function groupTurnpointMarkersByPixelDistance(
  turnpointIndices: number[],
  points: TrackPoint[],
  projectToPixel: (point: TrackPoint) => Pixel,
  thresholdPx: number,
): TurnpointMarkerGroup[] {
  const groups: ClusterInProgress[] = []

  turnpointIndices.forEach((index, position) => {
    // Unguarded: turnpointIndices are parse-validated to be in range for points before a
    // ScoringGeometry is ever constructed (see parse-track.ts's assertIndicesConsistent /
    // assertTriangleShapeConsistent), so an out-of-range index here would already mean a bug
    // upstream of this function, not a case for it to defend against.
    const point = points[index]
    const letter = turnpointLetter(position)
    const pixel = projectToPixel(point)

    const nearbyCluster = groups.find((cluster) => hasMemberWithin(cluster, pixel, thresholdPx))
    if (nearbyCluster) {
      nearbyCluster.group.letters.push(letter)
      nearbyCluster.pixels.push(pixel)
      return
    }

    // Anchored at this, the group's first member, and never moved once later members join it
    // (a merge only pushes onto `letters`/`pixels`, never touches `group.point`): the badge
    // always sits exactly on one of the flight's own real turnpoints. The alternative, a
    // centroid of the merged members, would place the badge on a computed position that sits on
    // no real turnpoint at all — a worse anchor for a marker whose whole job is to mark a place
    // the pilot actually flew over.
    groups.push({ group: { point, letters: [letter] }, pixels: [pixel] })
  })

  return groups.map(({ group }) => group)
}
