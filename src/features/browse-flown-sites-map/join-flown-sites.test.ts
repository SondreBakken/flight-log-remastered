import { describe, expect, it } from 'vitest'
import { joinFlownSites } from './join-flown-sites'
import type { Flight, Takeoff } from '@/lib/flightlog/types'

const NORWAY = 160
const CURATED = [NORWAY] as const

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 4549,
    date: '2026-07-20',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: { countryId: NORWAY, takeoffId: 15 },
    glider: 'skywalk Mescal 6',
    duration: '00:30',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

function takeoff(overrides: Partial<Takeoff> = {}): Takeoff {
  return {
    takeoffId: 15,
    name: 'Bismo (Riksanlegget)',
    lat: 61.6,
    lon: 8.5,
    wind: 56,
    countryId: NORWAY,
    regionId: 1,
    subregionId: 0,
    altitude: 900,
    altitudeDiff: 400,
    ...overrides,
  }
}

describe('joinFlownSites', () => {
  it('matches a flight whose takeoffRef resolves in the curated dataset, carrying the takeoff\'s coordinates', () => {
    const result = joinFlownSites([flight()], [takeoff()], CURATED)

    expect(result.sites).toEqual([
      { takeoffId: 15, countryId: NORWAY, name: 'Bismo (Riksanlegget)', lat: 61.6, lon: 8.5, flightCount: 1 },
    ])
    expect(result.unmatched).toEqual([])
  })

  it('sums flightCount across several flights at the same matched site into one entry, not one per flight', () => {
    const result = joinFlownSites(
      [flight({ flightCount: 2 }), flight({ flightCount: 3 })],
      [takeoff()],
      CURATED,
    )

    expect(result.sites).toHaveLength(1)
    expect(result.sites[0]?.flightCount).toBe(5)
  })

  it('flags a link-less flight (no takeoffRef) as unmatched with reason "unlinked", never dropped', () => {
    const result = joinFlownSites(
      [flight({ takeoffRef: null, takeoff: null, flightCount: 4 })],
      [takeoff()],
      CURATED,
    )

    expect(result.sites).toEqual([])
    expect(result.unmatched).toEqual([{ name: 'Unknown takeoff', reason: 'unlinked', flightCount: 4 }])
  })

  it('flags a flight referencing a non-curated country as unmatched with reason "uncurated-country"', () => {
    const result = joinFlownSites(
      [flight({ takeoffRef: { countryId: 73, takeoffId: 558 }, takeoff: 'Laragne, Chabre' })],
      [takeoff()],
      CURATED,
    )

    expect(result.sites).toEqual([])
    expect(result.unmatched).toEqual([{ name: 'Laragne, Chabre', reason: 'uncurated-country', flightCount: 1 }])
  })

  it('flags a curated-country ref whose takeoffId isn\'t in that country\'s own dataset as "not-found"', () => {
    const result = joinFlownSites(
      [flight({ takeoffRef: { countryId: NORWAY, takeoffId: 999999 }, takeoff: 'Ghost Site' })],
      [takeoff()],
      CURATED,
    )

    expect(result.sites).toEqual([])
    expect(result.unmatched).toEqual([{ name: 'Ghost Site', reason: 'not-found', flightCount: 1 }])
  })

  it('flags a matched takeoff whose own coordinates are the placeholder/corrupt shape as "no-known-location", never plotted at 0,0', () => {
    const result = joinFlownSites(
      [flight({ takeoffRef: { countryId: NORWAY, takeoffId: 15 }, takeoff: 'Trysil, Lerberget' })],
      [takeoff({ lat: 0, lon: 0 })],
      CURATED,
    )

    expect(result.sites).toEqual([])
    expect(result.unmatched).toEqual([{ name: 'Trysil, Lerberget', reason: 'no-known-location', flightCount: 1 }])
  })

  it('groups unmatched flights sharing the same ref into one entry (two flights at the same foreign site), not one per flight', () => {
    const result = joinFlownSites(
      [
        flight({ takeoffRef: { countryId: 73, takeoffId: 558 }, takeoff: 'Laragne, Chabre', flightCount: 2 }),
        flight({ takeoffRef: { countryId: 73, takeoffId: 558 }, takeoff: 'Laragne, Chabre', flightCount: 1 }),
      ],
      [takeoff()],
      CURATED,
    )

    expect(result.unmatched).toEqual([{ name: 'Laragne, Chabre', reason: 'uncurated-country', flightCount: 3 }])
  })

  it('groups link-less unmatched flights by display name, since they carry no ref to group by', () => {
    const result = joinFlownSites(
      [
        flight({ takeoffRef: null, takeoff: 'Some Site', flightCount: 1 }),
        flight({ takeoffRef: null, takeoff: 'Some Site', flightCount: 2 }),
      ],
      [takeoff()],
      CURATED,
    )

    expect(result.unmatched).toEqual([{ name: 'Some Site', reason: 'unlinked', flightCount: 3 }])
  })

  it('produces distinct sites and unmatched entries from a mixed logbook (matched, foreign and link-less flights together)', () => {
    const result = joinFlownSites(
      [
        flight({ takeoffRef: { countryId: NORWAY, takeoffId: 15 } }),
        flight({ takeoffRef: { countryId: 73, takeoffId: 558 }, takeoff: 'Laragne, Chabre' }),
        flight({ takeoffRef: null, takeoff: null }),
      ],
      [takeoff()],
      CURATED,
    )

    expect(result.sites).toHaveLength(1)
    expect(result.unmatched).toHaveLength(2)
    expect(result.unmatched.map((u) => u.reason).sort()).toEqual(['uncurated-country', 'unlinked'])
  })

  it('returns both empty for an empty logbook — the "zero flights" case is the caller\'s to distinguish, not this function\'s', () => {
    const result = joinFlownSites([], [takeoff()], CURATED)

    expect(result).toEqual({ sites: [], unmatched: [] })
  })
})
