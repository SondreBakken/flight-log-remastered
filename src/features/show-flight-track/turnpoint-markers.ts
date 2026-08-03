import type { TrackPoint } from '@/lib/flightlog/types'
import { turnpointLetter } from './scoring-overlay'

// One rendered marker, carrying every letter that resolves to the same physical point (#78).
export type TurnpointMarkerGroup = {
  point: TrackPoint
  label: string
  letters: string[]
}

// Grouped by exact coordinate, not by index: track-984290's FAI triangle collides through a
// repeated index (D and E are both track_idx 1215, the same array element), but
// track-985713's flat triangle collides through two DIFFERENT indices (A at track_idx 13, B at
// track_idx 14) that independently resolve to the identical lon/lat — an index-keyed grouping
// would catch the first case and silently miss the second. Exact float equality (no distance
// tolerance) is deliberate: it's exactly what both real fixtures above need, and a tolerance
// would also start folding in near-identical-but-distinct turnpoints (e.g. 985713's own D/E
// pair, ~33 m apart) — that case is out of scope here, filed as #83.
export function groupTurnpointMarkers(turnpointIndices: number[], points: TrackPoint[]): TurnpointMarkerGroup[] {
  const groups: TurnpointMarkerGroup[] = []
  const groupByCoordinate = new Map<string, TurnpointMarkerGroup>()

  turnpointIndices.forEach((index, position) => {
    const point = points[index]
    const letter = turnpointLetter(position)
    const key = `${point.lon},${point.lat}`

    const existingGroup = groupByCoordinate.get(key)
    if (existingGroup) {
      existingGroup.letters.push(letter)
      existingGroup.label = existingGroup.letters.join('/')
      return
    }

    const group: TurnpointMarkerGroup = { point, label: letter, letters: [letter] }
    groupByCoordinate.set(key, group)
    groups.push(group)
  })

  return groups
}
