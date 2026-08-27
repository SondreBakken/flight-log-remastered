import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import { evaluateRequirements } from './evaluate-requirements'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('evaluateRequirements', () => {
  it('marks an experience item satisfied once the computed value meets the threshold', () => {
    const flights = Array.from({ length: 60 }, () => flight())
    const evaluated = evaluateRequirements('PP3', flights, 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect(totalFlights).toMatchObject({ kind: 'experience', current: 60, threshold: 60, satisfied: true })
  })

  it('marks an experience item unsatisfied below the threshold', () => {
    const flights = [flight()]
    const evaluated = evaluateRequirements('PP3', flights, 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect(totalFlights).toMatchObject({ satisfied: false, current: 1 })
  })

  it('carries a duration-threshold item\'s caveat through into the evaluated result', () => {
    const evaluated = evaluateRequirements('PP3', [], 'PP2', null, {})
    const flightsOver20 = evaluated.find((r) => r.id === 'flights-over-20min')
    expect((flightsOver20 as { caveat?: string }).caveat).toMatch(/single flight/)
  })

  it('leaves caveat undefined for an experience item that has none', () => {
    const evaluated = evaluateRequirements('PP3', [], 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect((totalFlights as { caveat?: string }).caveat).toBeUndefined()
  })

  it('reads a manual item\'s checked state from the checklist, defaulting to unchecked', () => {
    const evaluated = evaluateRequirements('PP2', [], null, null, { PP2: { 'theory-exam': true } })
    expect(evaluated.find((r) => r.id === 'theory-exam')).toMatchObject({ kind: 'manual', checked: true })
    expect(evaluated.find((r) => r.id === 'practical-skills')).toMatchObject({ kind: 'manual', checked: false })
  })

  it('satisfies a tenure item once levelSetAt is old enough and currentLevel matches sinceLevel', () => {
    const twoYearsAgo = new Date(Date.UTC(2024, 0, 1)).toISOString()
    const evaluated = evaluateRequirements('PP4', [], 'PP3', twoYearsAgo, {})
    const tenure = evaluated.find((r) => r.id === 'held-pp3-12-months')
    expect(tenure).toMatchObject({ kind: 'tenure', satisfied: true, minDays: 365 })
    expect((tenure as { daysHeld: number }).daysHeld).toBeGreaterThan(365)
  })

  it('reports a tenure item as unsatisfied with a null daysHeld when currentLevel does not match sinceLevel', () => {
    const evaluated = evaluateRequirements('PP4', [], 'PP2', null, {})
    const tenure = evaluated.find((r) => r.id === 'held-pp3-12-months')
    expect(tenure).toMatchObject({ satisfied: false, daysHeld: null })
  })

  it('reports a tenure item as unsatisfied when currentLevel matches but not enough time has passed', () => {
    const yesterday = new Date(Date.UTC(2026, 7, 26)).toISOString()
    const evaluated = evaluateRequirements('PP4', [], 'PP3', yesterday, {})
    expect(evaluated.find((r) => r.id === 'held-pp3-12-months')).toMatchObject({ satisfied: false })
  })
})
