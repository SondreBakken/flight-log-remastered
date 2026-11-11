import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track, TrackStats } from '@/lib/flightlog/types'
import { NULL_PLACEHOLDER } from './format-altitude'
import FlightTrack from './index'

// TrackHoverView composes TrackMap (a real maplibre-gl MapLibreMap against a canvas — jsdom has
// no WebGL context) and Barogram. This suite only cares about FlightTrack's own render body (the
// summary row above TrackHoverView and the stats section below it, see index.tsx), so the
// map/chart are stubbed out here rather than exercised — they're covered for real by
// scripts/verify-track-gradient.mts and friends against a live browser instead.
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
  maxSpeedKind: '10s/60s',
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
    screen.getByText('1 Jan 2020')
  })

  it('formats the duration and labels the max speed in the stat grid', () => {
    render(<FlightTrack track={trackWithStats(REAL_STATS)} />)

    const grid = within(screen.getByTestId('stat-grid'))
    grid.getByText('10 km/h (10 s) / 10 km/h (60 s)')
    grid.getByText('1 min')
  })

  it('shows duration and max altitude in a summary row', () => {
    render(<FlightTrack track={trackWithStats(REAL_STATS)} />)

    const row = within(screen.getByTestId('flight-summary-row'))
    row.getByText('1 min')
    row.getByText('804 m')
  })

  it('shows the null placeholder in the summary row for a null duration and max altitude', () => {
    render(<FlightTrack track={trackWithStats({ ...REAL_STATS, duration: null, maxAltitude: null })} />)

    const values = within(screen.getByTestId('flight-summary-row')).getAllByText(NULL_PLACEHOLDER)
    expect(values).toHaveLength(2)
  })

  it.each([212, 0])('shows Distance as "%s km" in the summary row after Max altitude', (distanceKm) => {
    render(<FlightTrack track={trackWithStats(REAL_STATS)} distanceKm={distanceKm} />)

    const row = screen.getByTestId('flight-summary-row')
    within(row).getByText(`${distanceKm} km`)
    const labels = within(row).getAllByRole('term').map((term) => term.textContent)
    expect(labels).toEqual(['Duration', 'Max altitude', 'Distance'])
  })

  it.each([undefined, null, Number.NaN])('omits the Distance item when distanceKm is %s', (distanceKm) => {
    render(<FlightTrack track={trackWithStats(REAL_STATS)} distanceKm={distanceKm} />)

    expect(within(screen.getByTestId('flight-summary-row')).queryByText('Distance')).toBeNull()
  })

  it('does not render Distance when the stats could not be read', () => {
    render(<FlightTrack track={trackWithStats('unparseable')} distanceKm={212} />)

    expect(screen.queryByText('212 km')).toBeNull()
  })

  it('omits the summary row when the stats could not be read', () => {
    render(<FlightTrack track={trackWithStats('unparseable')} />)

    expect(screen.queryByTestId('flight-summary-row')).toBeNull()
  })

  // #59's fix round: the stats block failing to parse must render a distinguishable fallback,
  // not a blank panel that looks identical to a flight that simply has no data.
  it('renders the unparseable fallback, not a blank panel, when the stats block could not be read', () => {
    render(<FlightTrack track={trackWithStats('unparseable')} />)

    screen.getByTestId('stats-unparseable')
    expect(screen.queryByText('2020-01-01')).toBeNull()
  })
})
