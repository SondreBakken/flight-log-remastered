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
  // A test asserting `rendered` equals some fixed string would pin the wrong thing: the old,
  // ambiguous `"00:30 (6)"` form carried the exact same duration and flightCount and would have
  // passed it too. What has to be pinned is that the rendering cannot be read as per-flight —
  // so this asserts the *shape* the old defect violated (an explicit "total" word tying the
  // duration to the flight count) and separately rules the old shape back out by name.
  it('labels an aggregated row as a total across the flight count, never as a per-flight duration', () => {
    const rendered = formatFlightDuration({ ...baseFlight, duration: '00:30', flightCount: 6 })

    expect(rendered).toContain('00:30')
    expect(rendered).toMatch(/\btotal\b/)
    expect(rendered).toMatch(/\b6 flights\b/)
    // The exact ambiguous form this bug shipped as ("duration (count)") — read as "6 flights of
    // 30 minutes each" — must never come back.
    expect(rendered).not.toBe('00:30 (6)')
  })
})
