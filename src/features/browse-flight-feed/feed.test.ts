import { describe, expect, it } from 'vitest'
import { buildFeedEntries, countNewEntries, maxTrackedTs, type PilotFeedResult, type PilotFeedSuccess } from './feed'
import type { Flight, Pilot, TrackIndexEntry } from '@/lib/flightlog/types'

// This file covers ONLY the "new since last visit" marking logic added for issue #5
// (maxTrackedTs, and classifyNewness exercised through buildFeedEntries's public surface —
// it is not exported on its own). buildFeedEntries's pre-existing merge/sort/slice/hasTrack
// behaviour is already covered by scripts/check-feed.mts and is deliberately not re-asserted
// here.

let nextTripId = 1
function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 1,
    date: '2026-01-01',
    country: null,
    takeoff: null,
    glider: null,
    duration: '1:00',
    flightCount: 1,
    distanceKm: 10,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

function makePilot(userId: number): Pilot {
  return { userId, name: `Pilot ${userId}`, country: null, club: null }
}

function success(overrides: Partial<PilotFeedSuccess> & { pilotId: number }): PilotFeedResult {
  return {
    status: 'success',
    pilot: makePilot(overrides.pilotId),
    flights: [],
    trackedTrips: [],
    ...overrides,
  }
}

describe('maxTrackedTs', () => {
  it('returns null when there are no tracked trips', () => {
    expect(maxTrackedTs([])).toBeNull()
  })

  it('returns the single ts when there is exactly one tracked trip', () => {
    const trips: TrackIndexEntry[] = [{ tripId: 1, updatedAt: '20260101000000' }]
    expect(maxTrackedTs(trips)).toBe('20260101000000')
  })

  it('returns the newest ts among several, regardless of list order', () => {
    const trips: TrackIndexEntry[] = [
      { tripId: 1, updatedAt: '20260101000000' },
      { tripId: 2, updatedAt: '20260601000000' },
      { tripId: 3, updatedAt: '20260315000000' },
    ]
    expect(maxTrackedTs(trips)).toBe('20260601000000')
  })
})

describe('buildFeedEntries — classifying flight newness against each pilot\'s watermark-at-load', () => {
  it('marks a tracked flight "new" when its ts is strictly newer than the watermark', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
    })
    const [entry] = buildFeedEntries([result], 10, new Map([[1, '20260101000000']]))
    expect(entry.newness).toBe('new')
  })

  it('does NOT mark a flight "new" when its ts exactly EQUALS the watermark — the measured inclusive-boundary bug (RED if classifyNewness flips from > to >=)', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
    })
    const [entry] = buildFeedEntries([result], 10, new Map([[1, '20260601000000']]))
    expect(entry.newness).toBe('not-new')
  })

  it('marks a flight "not-new" when its ts is older than the watermark', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20250101000000' }],
    })
    const [entry] = buildFeedEntries([result], 10, new Map([[1, '20260601000000']]))
    expect(entry.newness).toBe('not-new')
  })

  it('marks an UNTRACKED flight "unknown", never "not-new" — an untracked flight must not silently render as confidently checked (issue #5)', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({ pilotId: 1, flights: [flight], trackedTrips: [] })
    const [entry] = buildFeedEntries([result], 10, new Map([[1, '20260601000000']]))
    expect(entry.newness).toBe('unknown')
    expect(entry.newness).not.toBe('not-new')
    expect(entry.hasTrack).toBe(false)
  })

  it('a pilot never seen before (no watermark recorded) marks every TRACKED flight "new", not "not-new" or "unknown"', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
    })
    // No entry for pilot 1 in the watermarks map at all — the "never seen this pilot before" case.
    const [entry] = buildFeedEntries([result], 10, new Map())
    expect(entry.newness).toBe('new')
  })

  it('an untracked flight for a never-seen pilot is still "unknown", not "new" — absence of a watermark must not be conflated with absence of a track', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({ pilotId: 1, flights: [flight], trackedTrips: [] })
    const [entry] = buildFeedEntries([result], 10, new Map())
    expect(entry.newness).toBe('unknown')
  })

  it('newness is scoped per pilot: pilot A\'s watermark does not leak into classifying pilot B\'s flights', () => {
    const flightA = makeFlight({ userId: 1, date: '2026-01-01' })
    const flightB = makeFlight({ userId: 2, date: '2026-01-02' })
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, flights: [flightA], trackedTrips: [{ tripId: flightA.tripId, updatedAt: '20260101000000' }] }),
      success({ pilotId: 2, flights: [flightB], trackedTrips: [{ tripId: flightB.tripId, updatedAt: '20260101000000' }] }),
    ]
    const watermarksAtLoad = new Map([
      [1, '20250101000000'], // pilot A's flight is newer than THEIR watermark
      [2, '20260601000000'], // pilot B's flight is older than THEIR (different) watermark
    ])
    const entries = buildFeedEntries(results, 10, watermarksAtLoad)
    const byPilot = new Map(entries.map((entry) => [entry.pilot.userId, entry.newness]))
    expect(byPilot.get(1)).toBe('new')
    expect(byPilot.get(2)).toBe('not-new')
  })
})

describe('countNewEntries', () => {
  it('counts only "new" entries, excluding both "not-new" and "unknown"', () => {
    const newFlight = makeFlight({ userId: 1, date: '2026-01-01' })
    const notNewFlight = makeFlight({ userId: 1, date: '2026-01-02' })
    const untrackedFlight = makeFlight({ userId: 1, date: '2026-01-03' })
    const result = success({
      pilotId: 1,
      flights: [newFlight, notNewFlight, untrackedFlight],
      trackedTrips: [
        { tripId: newFlight.tripId, updatedAt: '20260601000000' },
        { tripId: notNewFlight.tripId, updatedAt: '20250101000000' },
      ],
    })
    const entries = buildFeedEntries([result], 10, new Map([[1, '20260101000000']]))
    expect(countNewEntries(entries)).toBe(1)
  })

  it('returns zero for an empty entry list', () => {
    expect(countNewEntries([])).toBe(0)
  })
})
