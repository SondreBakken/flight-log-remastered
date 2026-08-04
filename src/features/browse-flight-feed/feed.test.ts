import { describe, expect, it } from 'vitest'
import {
  anyPilotHasPriorVisit,
  buildFeedEntries,
  countNewEntries,
  fetchedTripIdsByPilot,
  shownTrackedTsByPilot,
  shownTripIdsByPilot,
  type FeedEntry,
  type PilotFeedResult,
  type PilotFeedSuccess,
} from './feed'
import type { Flight, Pilot } from '@/lib/flightlog/types'

// This file covers ONLY the "new since last visit" marking logic added for issue #5 (tracked
// flights) and extended to untracked flights by #62 — classifyTrackedNewness/
// classifyUntrackedNewness (exercised through buildFeedEntries's public surface — neither is
// exported on its own), plus shownTrackedTsByPilot, shownTripIdsByPilot,
// fetchedTripIdsByPilot, and anyPilotHasPriorVisit. buildFeedEntries's pre-existing
// merge/sort/slice/hasTrack behaviour is already covered by scripts/check-feed.mts and is
// deliberately not re-asserted here.

let nextTripId = 1
function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 1,
    date: '2026-01-01',
    country: null,
    takeoff: null,
    takeoffRef: null,
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
    seenTripIdsAtLoad: null,
    ...overrides,
  }
}

describe('buildFeedEntries — classifying TRACKED flight newness against each pilot\'s watermark-at-load', () => {
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

  it('does NOT mark a flight "new" when its ts exactly EQUALS the watermark — the measured inclusive-boundary bug (RED if classifyTrackedNewness flips from > to >=)', () => {
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

  it('a pilot never seen before (no watermark recorded) marks every TRACKED flight "new", not "not-new"', () => {
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

describe('buildFeedEntries — classifying UNTRACKED flight newness against the pilot\'s seen-trip set (#62)', () => {
  it('marks an untracked flight "new" when its tripId is NOT in the pilot\'s remembered set', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [],
      seenTripIdsAtLoad: new Set([999999]), // some other trip, not this one
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('new')
    expect(entry.hasTrack).toBe(false)
    expect(entry.trackedAt).toBeNull()
  })

  it('marks an untracked flight "not-new" when its tripId IS in the pilot\'s remembered set', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [],
      seenTripIdsAtLoad: new Set([flight.tripId]),
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('not-new')
  })

  it('a pilot never seen before (no seen-trip entry recorded — null, not an empty set) marks every untracked flight "new", mirroring the null-watermark case for tracked flights', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({ pilotId: 1, flights: [flight], trackedTrips: [] })
    // seenTripIdsAtLoad: null (default)
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('new')
  })

  it('an untracked flight for a pilot with an unrelated watermark is still classified from the seen-trip set, not the watermark — the two stores never cross-contaminate', () => {
    const flight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [],
      watermarkAtLoad: '20260101000000', // present, but irrelevant to an untracked flight
      seenTripIdsAtLoad: new Set([flight.tripId]),
    })
    const [entry] = buildFeedEntries([result], 10)
    expect(entry.newness).toBe('not-new')
  })

  it('newness for untracked flights is scoped per pilot: pilot A\'s remembered set does not leak into classifying pilot B\'s flights', () => {
    const flightA = makeFlight({ userId: 1, date: '2026-01-01' })
    const flightB = makeFlight({ userId: 2, date: '2026-01-02' })
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, flights: [flightA], seenTripIdsAtLoad: new Set([flightA.tripId]) }),
      // Pilot B's remembered set is seeded with flightA's tripId (a different pilot's flight)
      // and nothing else — flightB's OWN tripId is not in it, so flightB must read 'new'.
      // Leaking pilot A's classification (or pilot A's set) into pilot B would wrongly read
      // 'not-new' here.
      success({ pilotId: 2, flights: [flightB], seenTripIdsAtLoad: new Set([flightA.tripId]) }),
    ]
    const entries = buildFeedEntries(results, 10)
    const byPilot = new Map(entries.map((entry) => [entry.pilot.userId, entry.newness]))
    expect(byPilot.get(1)).toBe('not-new')
    expect(byPilot.get(2)).toBe('new')
  })
})

describe('id memory closes the year-window gap for a TRACKED flight (blocking finding #1)', () => {
  it('a flight shown as tracked on one load, then reported with no resolved track on a LATER load (MAX_YEARS_PER_PILOT pushed its year out of the window), classifies "not-new" from id memory rather than the null-seen-trip-entry default of "new"', () => {
    const flight = makeFlight({ userId: 1 })

    // Load 1: the flight has a resolved ts. shownTripIdsByPilot (the fix) remembers its id
    // alongside advancing the watermark — this is what use-flight-feed.ts's
    // rememberWhatWasShown does for every completed load.
    const load1Result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [{ tripId: flight.tripId, updatedAt: '20260101000000' }],
      watermarkAtLoad: null,
      seenTripIdsAtLoad: null,
    })
    const load1Entries = buildFeedEntries([load1Result], 10)
    expect(load1Entries[0]?.newness).toBe('new') // sanity: first ever load, no watermark yet
    const idMemoryAfterLoad1 = shownTripIdsByPilot(load1Entries).get(1)
    expect(idMemoryAfterLoad1).toEqual(new Set([flight.tripId])) // sanity: the fix actually remembered it

    // Load 2: the SAME trip id, but this time the route reports no resolved track for it at
    // all (trackedTrips: []) — the honest degradation MAX_YEARS_PER_PILOT's own doc comment
    // describes for a flight whose year fell out of the resolved window. Without blocking
    // finding #1's fix, seenTripIdsAtLoad would still be null here (nothing was ever written to
    // untracked-only id memory for a TRACKED flight), and classifyUntrackedNewness's null-signal
    // default would wrongly call it 'new' again, despite having already been shown and counted.
    const load2Result = success({
      pilotId: 1,
      flights: [flight],
      trackedTrips: [], // this load could not resolve a track for it
      watermarkAtLoad: '20260101000000', // load 1 already advanced this
      seenTripIdsAtLoad: idMemoryAfterLoad1 ?? null,
    })
    const load2Entries = buildFeedEntries([load2Result], 10)
    expect(load2Entries[0]?.hasTrack).toBe(false) // sanity: genuinely unresolved this load
    expect(load2Entries[0]?.newness).toBe('not-new')
  })
})

describe('countNewEntries', () => {
  it('counts only "new" entries, excluding "not-new" — tracked and untracked alike', () => {
    const newFlight = makeFlight({ userId: 1, date: '2026-01-01' })
    const notNewFlight = makeFlight({ userId: 1, date: '2026-01-02' })
    const newUntrackedFlight = makeFlight({ userId: 1, date: '2026-01-03' })
    const notNewUntrackedFlight = makeFlight({ userId: 1, date: '2026-01-04' })
    const result = success({
      pilotId: 1,
      flights: [newFlight, notNewFlight, newUntrackedFlight, notNewUntrackedFlight],
      trackedTrips: [
        { tripId: newFlight.tripId, updatedAt: '20260601000000' },
        { tripId: notNewFlight.tripId, updatedAt: '20250101000000' },
      ],
      watermarkAtLoad: '20260101000000',
      seenTripIdsAtLoad: new Set([notNewUntrackedFlight.tripId]),
    })
    const entries = buildFeedEntries([result], 10)
    expect(countNewEntries(entries)).toBe(2)
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
      { pilot, flight: makeFlight({ userId: 1 }), hasTrack: false, newness: 'new', trackedAt: null },
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

describe('shownTripIdsByPilot — id memory advances only over ids actually rendered, tracked or not (#62, extended by blocking finding #1)', () => {
  it('collects EVERY rendered trip id for a pilot, a tracked entry (non-null trackedAt) included — not scoped to untracked ones only, unlike the pre-fix version', () => {
    const pilot = makePilot(1)
    const untracked = makeFlight({ userId: 1 })
    const tracked = makeFlight({ userId: 1 })
    const entries: FeedEntry[] = [
      { pilot, flight: untracked, hasTrack: false, newness: 'new', trackedAt: null },
      { pilot, flight: tracked, hasTrack: true, newness: 'new', trackedAt: '20260101000000' },
    ]
    const candidates = shownTripIdsByPilot(entries)
    expect(candidates.get(1)).toEqual(new Set([untracked.tripId, tracked.tripId]))
  })

  it('a pilot contributing zero rendered entries is absent from the map entirely, not present with an empty set', () => {
    const candidates = shownTripIdsByPilot([])
    expect(candidates.has(1)).toBe(false)
  })

  it('scopes candidates per pilot: one pilot\'s shown ids do not leak into another\'s', () => {
    const flightA = makeFlight({ userId: 1 })
    const flightB = makeFlight({ userId: 2 })
    const entries: FeedEntry[] = [
      { pilot: makePilot(1), flight: flightA, hasTrack: false, newness: 'new', trackedAt: null },
      { pilot: makePilot(2), flight: flightB, hasTrack: false, newness: 'new', trackedAt: null },
    ]
    const candidates = shownTripIdsByPilot(entries)
    expect(candidates.get(1)).toEqual(new Set([flightA.tripId]))
    expect(candidates.get(2)).toEqual(new Set([flightB.tripId]))
  })

  it('an empty entry list produces no candidates', () => {
    expect(shownTripIdsByPilot([])).toEqual(new Map())
  })
})

describe('fetchedTripIdsByPilot — the per-pilot scope replaceSeenTripIds prunes stale ids against (#62, extended by blocking finding #1)', () => {
  it('includes EVERY fetched flight, tracked or not — not scoped to untracked ones only, unlike the pre-fix version: narrowing this would prune a tracked flight\'s id back out of memory the moment it resolves a track, defeating the fallback shownTripIdsByPilot exists to feed', () => {
    const trackedFlight = makeFlight({ userId: 1 })
    const untrackedFlight = makeFlight({ userId: 1 })
    const result = success({
      pilotId: 1,
      flights: [trackedFlight, untrackedFlight],
      trackedTrips: [{ tripId: trackedFlight.tripId, updatedAt: '20260101000000' }],
    })
    const scope = fetchedTripIdsByPilot([result])
    expect(scope.get(1)).toEqual(new Set([trackedFlight.tripId, untrackedFlight.tripId]))
  })

  it('a successful pilot with zero flights still gets an entry — an empty Set, not a missing key', () => {
    const result = success({ pilotId: 1, flights: [], trackedTrips: [] })
    const scope = fetchedTripIdsByPilot([result])
    expect(scope.has(1)).toBe(true)
    expect(scope.get(1)).toEqual(new Set())
  })

  it('a failed pilot has no entry at all — there is no fetched scope to prune against, and none should be inferred', () => {
    const scope = fetchedTripIdsByPilot([{ status: 'error', pilotId: 1, message: 'boom' }])
    expect(scope.has(1)).toBe(false)
  })
})

describe('anyPilotHasPriorVisit — a prior watermark OR a prior seen-trip entry counts as "seen before" (#62)', () => {
  it('true when at least one successful pilot had a prior watermark', () => {
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, watermarkAtLoad: '20260101000000' }),
      success({ pilotId: 2, watermarkAtLoad: null }),
    ]
    expect(anyPilotHasPriorVisit(results)).toBe(true)
  })

  it('true when at least one successful pilot had a prior seen-trip entry, even with no watermark at all — the pilot who has never uploaded a single GPS track (#62\'s motivating case) must not read as "first visit" forever', () => {
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, watermarkAtLoad: null, seenTripIdsAtLoad: new Set([123]) }),
      success({ pilotId: 2, watermarkAtLoad: null, seenTripIdsAtLoad: null }),
    ]
    expect(anyPilotHasPriorVisit(results)).toBe(true)
  })

  it('false when every successful pilot has no prior watermark AND no prior seen-trip entry — a genuine first visit', () => {
    const results: PilotFeedResult[] = [
      success({ pilotId: 1, watermarkAtLoad: null, seenTripIdsAtLoad: null }),
      success({ pilotId: 2, watermarkAtLoad: null, seenTripIdsAtLoad: null }),
    ]
    expect(anyPilotHasPriorVisit(results)).toBe(false)
  })

  it('a failed pilot contributes neither signal either way', () => {
    expect(anyPilotHasPriorVisit([{ status: 'error', pilotId: 1, message: 'boom' }])).toBe(false)
  })
})
