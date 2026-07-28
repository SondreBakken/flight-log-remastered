import { describe, expect, it } from 'vitest'
import {
  anyPilotHasPriorWatermark,
  buildFeedEntries,
  countNewEntries,
  shownTrackedTsByPilot,
  type FeedEntry,
  type PilotFeedResult,
  type PilotFeedSuccess,
} from './feed'
import type { Flight, Pilot } from '@/lib/flightlog/types'

// This file covers ONLY the "new since last visit" marking logic added for issue #5
// (classifyNewness, exercised through buildFeedEntries's public surface — it is not exported
// on its own — plus shownTrackedTsByPilot and anyPilotHasPriorWatermark). buildFeedEntries's
// pre-existing merge/sort/slice/hasTrack behaviour is already covered by scripts/check-feed.mts
// and is deliberately not re-asserted here.

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
    watermarkAtLoad: null,
    ...overrides,
  }
}

describe('buildFeedEntries — classifying flight newness against each pilot\'s watermark-at-load', () => {
  it('marks a tracked flight "new" when its ts is strictly newer than the watermark', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
      watermarkAtLoad: '20260101000000',
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('new')
  })

  it('does NOT mark a flight "new" when its ts exactly EQUALS the watermark — the measured inclusive-boundary bug (RED if classifyNewness flips from > to >=)', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
      watermarkAtLoad: '20260601000000',
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('not-new')
  })

  it('marks a flight "not-new" when its ts is older than the watermark', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20250101000000' }],
      watermarkAtLoad: '20260601000000',
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('not-new')
  })

  it('marks an UNTRACKED flight "unknown", never "not-new" — an untracked flight must not silently render as confidently checked (issue #5)', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({ pilotId: 1, flights: [flight], trackedTrips: [], watermarkAtLoad: '20260601000000' })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('unknown')
    expect(entry.newness).not.toBe('not-new')
    expect(entry.hasTrack).toBe(false)
    expect(entry.trackedAt).toBeNull()
  })

  it('a pilot never seen before (no watermark recorded) marks every TRACKED flight "new", not "not-new" or "unknown"', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260601000000' }],
      // watermarkAtLoad: null (default) — the "never seen this pilot before" case.
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('new')
  })

  it('an untracked flight for a never-seen pilot is still "unknown", not "new" — absence of a watermark must not be conflated with absence of a track', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({ pilotId: 1, flights: [flight], trackedTrips: [] })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('unknown')
  })

  it('newness is scoped per pilot: pilot A\'s watermark does not leak into classifying pilot B\'s flights', () => {
    const flightA = makeFlight({ userId: 1, date: '2026-01-01' })
    const flightB = makeFlight({ userId: 2, date: '2026-01-02' })
    const results: PilotFeedResult[] = [
      success({
        pilotId: 1,
        flights: [flightA],
        trackedTrips: [{ tripId: flightA.tripId, updatedAt: '20260101000000' }],
        watermarkAtLoad: '20250101000000', // pilot A's flight is newer than THEIR watermark
      }),
      success({
        pilotId: 2,
        flights: [flightB],
        trackedTrips: [{ tripId: flightB.tripId, updatedAt: '20260101000000' }],
        watermarkAtLoad: '20260601000000', // pilot B's flight is older than THEIR (different) watermark
      }),
    ]
    const entries = buildFeedEntries(results, 10)
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
      watermarkAtLoad: '20260101000000',
    })
    const entries = buildFeedEntries([result], 10)
    expect(countNewEntries(entries)).toBe(1)
  })

  it('returns zero for an empty entry list', () => {
    expect(countNewEntries([])).toBe(0)
  })
})

describe('shownTrackedTsByPilot — the watermark advances only over what was actually rendered', () => {
  it('a flight fetched but truncated out of the merged feed contributes no advance candidate for its pilot (blocking finding #1)', () => {
    const shownFlight: FeedEntry = {
      pilot: makePilot(1),
      flight: makeFlight({ userId: 1 }),
      hasTrack: true,
      newness: 'new',
      trackedAt: '20260601000000',
    }
    // Never appears in the `entries` passed in below — simulating a flight that WAS fetched
    // (see feed.ts's toFeedEntries) but got cut by FEED_SIZE/MAX_PILOTS_PER_FEED before
    // shownTrackedTsByPilot ever saw it.
    const candidates = shownTrackedTsByPilot([shownFlight])
    expect(candidates.get(1)).toBe('20260601000000')
    expect(candidates.has(2)).toBe(false)
  })

  it('takes the newest ts among a pilot\'s own shown entries, ignoring an untracked one (null trackedAt)', () => {
    const pilot = makePilot(1)
    const entries: FeedEntry[] = [
      { pilot, flight: makeFlight({ userId: 1 }), hasTrack: true, newness: 'new', trackedAt: '20260501000000' },
      { pilot, flight: makeFlight({ userId: 1 }), hasTrack: true, newness: 'not-new', trackedAt: '20260401000000' },
      { pilot, flight: makeFlight({ userId: 1 }), hasTrack: false, newness: 'unknown', trackedAt: null },
    ]
    const candidates = shownTrackedTsByPilot(entries)
    expect(candidates.get(1)).toBe('20260501000000')
  })

  it('scopes candidates per pilot: one pilot\'s newest ts does not leak into another\'s', () => {
    const entries: FeedEntry[] = [
      { pilot: makePilot(1), flight: makeFlight({ userId: 1 }), hasTrack: true, newness: 'new', trackedAt: '20260601000000' },
      { pilot: makePilot(2), flight: makeFlight({ userId: 2 }), hasTrack: true, newness: 'new', trackedAt: '20250101000000' },
    ]
    const candidates = shownTrackedTsByPilot(entries)
    expect(candidates.get(1)).toBe('20260601000000')
    expect(candidates.get(2)).toBe('20250101000000')
  })

  it('an empty entry list produces no candidates', () => {
    expect(shownTrackedTsByPilot([])).toEqual(new Map())
  })
})

describe('anyPilotHasPriorWatermark', () => {
  it('true when at least one successful pilot had a prior watermark', () => {
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, watermarkAtLoad: '20260101000000' }),
      success({ pilotId: 2, watermarkAtLoad: null }),
    ]
    expect(anyPilotHasPriorWatermark(results)).toBe(true)
  })

  it('false when every successful pilot has no prior watermark — a genuine first visit', () => {
    const results: PilotFeedResult[] = [success({ pilotId: 1, watermarkAtLoad: null }), success({ pilotId: 2, watermarkAtLoad: null })]
    expect(anyPilotHasPriorWatermark(results)).toBe(false)
  })

  it('a failed pilot contributes no watermark either way', () => {
    expect(anyPilotHasPriorWatermark([{ status: 'error', pilotId: 1, message: 'boom' }])).toBe(false)
  })
})
