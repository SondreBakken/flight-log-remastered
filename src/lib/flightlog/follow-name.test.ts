import { describe, expect, it } from 'vitest'
import { pilotNameOrNull, takeoffNameOrNull } from './follow-name'
import type { TakeoffDetail } from './types'

describe('pilotNameOrNull', () => {
  it('returns the name of a real pilot', () => {
    expect(pilotNameOrNull(12345, { userId: 12345, name: 'Kari Nordmann', country: 'Norway', club: 'Voss HPK' })).toBe(
      'Kari Nordmann',
    )
  })

  it('returns null for the synthetic fallback profile, which is not a name', () => {
    expect(pilotNameOrNull(12345, { userId: 12345, name: 'Pilot 12345', country: null, club: null })).toBeNull()
  })

  it('keeps the name of a real pilot with no country or club', () => {
    expect(pilotNameOrNull(12345, { userId: 12345, name: 'Kari Nordmann', country: null, club: null })).toBe(
      'Kari Nordmann',
    )
  })
})

describe('takeoffNameOrNull', () => {
  const detail: TakeoffDetail = {
    takeoffId: 7,
    name: 'Hanguren',
    region: null,
    altitude: null,
    description: null,
    linkUrl: null,
    createdAt: null,
    updatedAt: null,
    siteRecords: [],
  }

  it('returns the takeoff name', () => {
    expect(takeoffNameOrNull(detail)).toBe('Hanguren')
  })

  it('returns null when the takeoff was not found', () => {
    expect(takeoffNameOrNull(null)).toBeNull()
  })
})
