'use client'

import { useState } from 'react'
import type { ScoringGeometryKind, Track, TrackPoint } from '@/lib/flightlog/types'
import { Barogram } from './barogram'
import { resolveDefaultScoringKind } from './scoring-overlay'
import { ScoringOverlaySelect } from './scoring-overlay-select'
import { TrackMap } from './track-map'

type TrackHoverViewProps = {
  points: TrackPoint[]
  scoring: Track['scoring']
}

// The map and the chart are two independent client components that need to react to the
// same hovered point; something above both has to own that state. This component exists
// only to be that owner, kept as small and as low in the tree as possible so the rest of
// the feature (StatGrid, and the data fetch in page.tsx one level up) can stay server-only
// — moving the client boundary down to wrap just these two views, rather than converting
// the feature root itself, which would drag every sibling in the same file into the client
// bundle along with it.
//
// The shared value is an INDEX into `points`, not a derived property like elapsed seconds:
// see track-hover.ts's module doc comment for why elapsed seconds cannot serve as this
// identity (its fallback tail is not unique), and why an index into this same array can.
export function TrackHoverView({ points, scoring }: TrackHoverViewProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedKind, setSelectedKind] = useState<ScoringGeometryKind | null>(() =>
    resolveDefaultScoringKind(scoring),
  )

  return (
    <>
      <ScoringOverlaySelect scoring={scoring} selectedKind={selectedKind} onSelectKind={setSelectedKind} />
      <TrackMap
        points={points}
        hoveredIndex={hoveredIndex}
        onHoverIndex={setHoveredIndex}
        scoringGeometry={selectedKind ? scoring[selectedKind] : null}
      />
      <Barogram points={points} hoveredIndex={hoveredIndex} onHoverIndex={setHoveredIndex} />
    </>
  )
}
