import { describe, expect, it } from 'vitest'
import { isFallbackPilot } from './is-fallback-pilot'

// Each case is chosen to kill a specific mutation of the predicate, not just exercise the happy path.
describe('isFallbackPilot', () => {
  it('detects the exact synthetic fallback shape', () => {
    expect(isFallbackPilot(12345, { userId: 12345, name: 'Pilot 12345', country: null, club: null })).toBe(true)
  })

  it('does not flag a real pilot with a name, country, and club', () => {
    expect(isFallbackPilot(12345, { userId: 12345, name: 'Kari Nordmann', country: 'Norway', club: 'Voss HPK' })).toBe(false)
  })

  it('needs more than the fallback name: a country on file rules it out (kills && -> ||)', () => {
    expect(isFallbackPilot(12345, { userId: 12345, name: 'Pilot 12345', country: 'Norway', club: null })).toBe(false)
  })

  it('needs more than a missing country and club: a real pilot may simply have neither', () => {
    expect(isFallbackPilot(12345, { userId: 12345, name: 'Kari Nordmann', country: null, club: null })).toBe(false)
  })

  it("needs the fallback name of this pilot id, not another pilot's", () => {
    expect(isFallbackPilot(12345, { userId: 12345, name: 'Pilot 999', country: null, club: null })).toBe(false)
  })

  it('compares against the pilotId argument, not pilot.userId', () => {
    expect(isFallbackPilot(999, { userId: 12345, name: 'Pilot 12345', country: null, club: null })).toBe(false)
  })
})
