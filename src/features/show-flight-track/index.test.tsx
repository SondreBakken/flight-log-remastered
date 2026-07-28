import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track, TrackStats } from '@/lib/flightlog/types'
import FlightTrack from './index'

// TrackHoverView composes TrackMap (a real maplibre-gl MapLibreMap against a canvas — jsdom has
// no WebGL context) and Barogram. This suite only cares about FlightTrack's own render body (the
// stats section below TrackHoverView, see index.tsx), so the map/chart are stubbed out here
// rather than exercised — they're covered for real by scripts/verify-track-gradient.mts and
// friends against a live browser instead.
vi.mock('./track-hover-view', () => ({
  TrackHoverView: () => null,
}))

const EMPTY_SCORING = Object.fromEntries(SCORING_KINDS.map((kind) => [kind, null])) as Record<
  ScoringGeometryKind,
  ScoringGeometryResult
>

const REAL_STATS: TrackStats = {
  date: '2020-01-01',
  startFinish: '00:00:00 - 00:00:40',
  duration: '0 : 00 : 40',
  maxAltitude: 804,
  minAltitude: 800,
  maxSpeed: '10 / 10 km/h',
  maxClimb: '0.1 / 0.1 m/s',
  minClimb: '-0.1 / -0.1 m/s',
}

function trackWithStats(stats: Track['stats']): Track {
  return { tripId: 1, points: [], stats, scoring: EMPTY_SCORING }
}

describe('FlightTrack', () => {
  it('renders the stat grid when the stats block parsed', () => {
    render(<FlightTrack track={trackWithStats(REAL_STATS)} />)

    expect(screen.queryByTestId('stats-unparseable')).toBeNull()
    screen.getByText('2020-01-01')
  })

  // #59's fix round: the stats block failing to parse must render a distinguishable fallback,
  // not a blank panel that looks identical to a flight that simply has no data.
  it('renders the unparseable fallback, not a blank panel, when the stats block could not be read', () => {
    render(<FlightTrack track={trackWithStats('unparseable')} />)

    screen.getByTestId('stats-unparseable')
    expect(screen.queryByText('2020-01-01')).toBeNull()
  })
})
