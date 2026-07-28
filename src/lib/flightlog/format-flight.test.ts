import { describe, expect, it } from 'vitest'
import type { Flight } from './types'
import { formatFlightDuration } from './format-flight'

const baseFlight: Flight = {
  tripId: 1,
  userId: 12677,
  date: '2026-07-23',
  country: 'Norway',
  takeoff: 'Voss, Hjelle/Gjelle',
  glider: 'skywalk Mescal 6',
  duration: '00:30',
  flightCount: 1,
  distanceKm: null,
  openDistanceKm: null,
  note: null,
}

describe('formatFlightDuration', () => {
  it('renders a single-flight row\'s duration unmodified', () => {
    expect(formatFlightDuration(baseFlight)).toBe('00:30')
  })

  it('renders — for a flight with no recorded duration, aggregated or not', () => {
    expect(formatFlightDuration({ ...baseFlight, duration: null, flightCount: 6 })).toBe('—')
  })

  // #68: pilot 12677's own logbook aggregates this exact row as "00:30/ 6" — four rows
  // totalling ten flights, matched against rqtid=1's independently labelled "Time (hours)"
  // column (0.8500h = 5 + 10 + 30 + 6 minutes) — which only reconciles if `duration` is the
  // GROUP TOTAL across `flightCount` flights, never a per-flight duration. Reading a per-flight
  // duration instead overshoots by 4x (211 min vs the true 51 min) for this same pilot.
  //
  // No assertion can verify that a string *means* "total, not per-flight" — meaning is a
  // property of the reader, not the string. What this pins instead is the exact phrasing that
  // was reviewed and confirmed to carry that meaning, so any future edit to it has to be
  // re-reviewed rather than silently drifting to something that once again reads as per-flight
  // (e.g. bringing back the old `"00:30 (6)"` shape, or something equally ambiguous) while still
  // satisfying a looser check.
  it('labels an aggregated row as a total across the flight count, never as a per-flight duration', () => {
    const rendered = formatFlightDuration({ ...baseFlight, duration: '00:30', flightCount: 6 })

    expect(rendered).toBe('00:30 total (6 flights)')
  })

  // Boundary for the `flightCount > 1` branch itself: pilot 12677's own logbook has a
  // `flightCount === 2` aggregated row ("00:10/ 2"), not just the single-flight and
  // six-flight cases above. Without this, a threshold typo (e.g. `> 5`) that renders a
  // two-flight row as a bare, count-less `00:10` — indistinguishable from a single flight,
  // worse than the original defect — would pass the rest of this file.
  it('labels a two-flight aggregated row as a total, not as a bare single-flight duration', () => {
    const rendered = formatFlightDuration({ ...baseFlight, duration: '00:10', flightCount: 2 })

    expect(rendered).toBe('00:10 total (2 flights)')
  })
})
