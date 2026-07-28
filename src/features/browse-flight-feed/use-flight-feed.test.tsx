import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { RecentFlightsSuccessBody } from '@/app/api/pilots/[userId]/recent-flights/contract'
import type { Pilot } from '@/lib/flightlog/types'
import type { usePilotFeedResults as UsePilotFeedResults, FlightFeedResults } from './use-flight-feed'

// This file exercises the actual WIRING in usePilotFeedResults — not just the pure pieces
// (feed.ts's classifyTrackedNewness/classifyUntrackedNewness, watermark-store's
// advanceWatermark, seen-trip-store's replaceSeenTripIds) that feed.test.ts, watermark-ids.
// test.ts, and seen-trip-ids.test.ts already cover in isolation. Those pure-function tests
// cannot catch a regression where the hook reads or writes either store at the wrong point, or
// forgets to update it at all. The watermark describe block below covers tracked flights (#5);
// the seen-trip-store describe block covers untracked flights (#62) with the same shape of
// proof, since the same trap (advancing/recording over fetched-but-unrendered data) applies to
// both stores identically.
//
// Inspecting localStorage after the hook's effect runs proves recordSeen was called with SOME
// value, but it CANNOT prove the read/write ORDERING was correct: swapping so the watermark
// advance runs before the pilot's watermark is read, or reading it again right before
// classifying instead of once up front, leaves the exact same byte-identical localStorage as
// correct code — the write itself is unaffected either way. What differs is what the hook
// RETURNS while classifying: a flight classified against a watermark that has already been
// advanced past it reads as 'not-new' instead of 'new'. So the ordering test below renders the
// hook and asserts on `entries`/`newness`, not just localStorage — see it for exactly which two
// assertions are needed to kill both directions of the bug (blocking finding #2).

const WATERMARK_KEY = 'flight-log:track-watermarks'
const PILOT_ID = 4549

const pilot: Pilot = { userId: PILOT_ID, name: 'Test Pilot', country: null, club: null }

function stubbedFeedResponse(): RecentFlightsSuccessBody {
  return {
    pilot,
    flights: [
      {
        tripId: 991729,
        userId: PILOT_ID,
        date: '2026-05-23',
        country: null,
        takeoff: 'Voss',
        glider: null,
        duration: '1:30',
        flightCount: 1,
        distanceKm: 20,
        openDistanceKm: null,
        note: null,
      },
    ],
    trackedTrips: [{ tripId: 991729, updatedAt: '20260523164423' }],
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

// watermark-store/storage.ts hydrates once and caches at module scope (the flag flips true on
// first read and never flips back), and Vitest isolates modules per FILE, not per test — so
// without this, a watermark one test's own recordSeen call advances stays cached in memory for
// every later test in this file, regardless of what localStorage is reseeded to. A fresh
// instance per test (mirroring follow-button/index.test.tsx's loadFreshFollowButton) is the
// only way each test's seeded localStorage is what the hook actually hydrates from.
async function loadFreshUsePilotFeedResults(): Promise<typeof UsePilotFeedResults> {
  vi.resetModules()
  const mod = await import('./use-flight-feed')
  return mod.usePilotFeedResults
}

// A minimal harness that mounts the given hook instance and lets its effect run. `onResults`,
// when passed, fires on every render with whatever the hook currently returns — the only way a
// test can inspect `entries`/`newness`, since usePilotFeedResults renders nothing on its own.
function FeedHarness({
  useHook,
  pilotIds,
  onResults,
}: {
  useHook: typeof UsePilotFeedResults
  pilotIds: number[]
  onResults?: (results: FlightFeedResults) => void
}) {
  const results = useHook(pilotIds)
  onResults?.(results)
  return null
}

describe('usePilotFeedResults — watermark wiring (issue #5)', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    window.localStorage.clear()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('advances the pilot\'s watermark to the newest tracked ts once their feed has loaded, without touching flightlog.org again (see tracks.test.ts for the request-count proof at the fetch layer)', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(stubbedFeedResponse())) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} />)

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')
      expect(stored).toEqual({ [PILOT_ID]: '20260523164423' })
    })
  })

  it('classifies newness against the watermark as it stood BEFORE this load advances it, and only then advances it forward — proven by inspecting what the hook returns, not just localStorage, which is byte-identical for both a correct implementation and a read/write reordering bug (blocking finding #2)', async () => {
    // A watermark older than the fetched flight's own ts, seeded BEFORE the hook mounts —
    // this is the pilot's real watermark-at-load.
    window.localStorage.setItem(WATERMARK_KEY, JSON.stringify({ [PILOT_ID]: '20250101000000' }))
    globalThis.fetch = vi.fn(async () => jsonResponse(stubbedFeedResponse())) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} onResults={(results) => (latest = results)} />)

    await waitFor(() => expect(latest?.isLoading).toBe(false))

    // Assertion 1 — kills the watermark being read AFTER it has already been advanced for
    // this same load (e.g. recordSeen moved before the read, or the read moved to just before
    // classification instead of once up front): if the watermark used for classification were
    // already equal to the flight's own ts, classifyTrackedNewness's strict `>` would call it
    // 'not-new' instead.
    expect(latest?.entries[0]?.newness).toBe('new')

    // Assertion 2 — kills the advance being dropped entirely (e.g. the final recordSeen loop
    // deleted, or fed an empty entries list): if nothing ever persists, localStorage stays at
    // the pre-seeded value forever instead of advancing to the newly-tracked ts.
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')
      expect(stored).toEqual({ [PILOT_ID]: '20260523164423' })
    })
  })

  it('does NOT advance a pilot\'s watermark for a flight that was fetched but truncated out of the merged feed by another pilot\'s newer flights (blocking finding #1, the measured scenario: a followed pilot contributing zero rendered entries must not have their watermark move)', async () => {
    const busyPilotId = 61
    const busyPilot: Pilot = { userId: busyPilotId, name: 'Busy Pilot', country: null, club: null }
    const quietPilotId = 62
    const quietPilot: Pilot = { userId: quietPilotId, name: 'Quiet Pilot', country: null, club: null }

    // FEED_SIZE (30) recent flights, all in 2026 — enough on their own to fill the merged
    // feed and truncate quietPilot's single, much older flight out of it entirely.
    const busyFlights = Array.from({ length: 30 }, (_, index) => ({
      tripId: 1000 + index,
      userId: busyPilotId,
      date: `2026-06-${String(30 - (index % 28)).padStart(2, '0')}`,
      country: null,
      takeoff: null,
      glider: null,
      duration: '1:00',
      flightCount: 1,
      distanceKm: 10,
      openDistanceKm: null,
      note: null,
    }))
    const busyBody: RecentFlightsSuccessBody = {
      pilot: busyPilot,
      flights: busyFlights,
      trackedTrips: busyFlights.map((f) => ({ tripId: f.tripId, updatedAt: '20260601000000' })),
    }
    const quietBody: RecentFlightsSuccessBody = {
      pilot: quietPilot,
      flights: [
        {
          tripId: 2000,
          userId: quietPilotId,
          date: '2020-01-01',
          country: null,
          takeoff: null,
          glider: null,
          duration: '1:00',
          flightCount: 1,
          distanceKm: 10,
          openDistanceKm: null,
          note: null,
        },
      ],
      trackedTrips: [{ tripId: 2000, updatedAt: '20200101000000' }],
    }

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/${busyPilotId}/`)) return jsonResponse(busyBody)
      if (url.includes(`/${quietPilotId}/`)) return jsonResponse(quietBody)
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(<FeedHarness useHook={useHook} pilotIds={[busyPilotId, quietPilotId]} onResults={(results) => (latest = results)} />)

    await waitFor(() => expect(latest?.isLoading).toBe(false))
    // Sanity: the merged, FEED_SIZE-truncated feed really does contain none of quietPilot's
    // flights — otherwise this test would prove nothing about truncation.
    expect(latest?.entries.every((entry) => entry.pilot.userId === busyPilotId)).toBe(true)

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')
      expect(stored[busyPilotId]).toBe('20260601000000')
    })
    expect(JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')[quietPilotId]).toBeUndefined()
  })

  it('does NOT advance the watermark for a pilot whose feed load fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 502 })) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} />)

    // Give the failing fetch a chance to settle, then confirm nothing was ever written.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(window.localStorage.getItem(WATERMARK_KEY)).toBeNull()
  })

  it(
    "does NOT re-announce a tracked flight as new once MAX_YEARS_PER_PILOT's window slides past its year on a LATER load and its ts goes unresolved again (blocking finding #1: id memory, not just the watermark, must remember a rendered TRACKED flight's id too)",
    async () => {
      // Load 1: the flight has a resolved track ts. It advances the watermark AND (post-fix)
      // gets remembered in id memory, since shownTripIdsByPilot records every rendered flight's
      // id, tracked or not — not only the untracked ones the pre-fix version scoped to.
      globalThis.fetch = vi.fn(async () => jsonResponse(stubbedFeedResponse())) as unknown as typeof fetch
      const firstLoadHook = await loadFreshUsePilotFeedResults()
      render(<FeedHarness useHook={firstLoadHook} pilotIds={[PILOT_ID]} />)
      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')
        expect(stored).toEqual({ [PILOT_ID]: '20260523164423' })
      })

      // Load 2: the SAME trip id, but this time the route reports no resolved track for it —
      // the honest degradation MAX_YEARS_PER_PILOT's own doc comment describes for a flight
      // whose year fell out of the resolved window (feed.ts). On `main` (pre-#62) this flight
      // read 'unknown' — no badge. Post-#62, without this fix, it would fall through to the
      // null-seen-trip-entry default and read 'new' again, even though it was already shown and
      // already counted on load 1 — the measured regression the review proved via a real
      // window-shift merge.
      globalThis.fetch = vi.fn(async () =>
        jsonResponse({ ...stubbedFeedResponse(), trackedTrips: [] }),
      ) as unknown as typeof fetch
      const secondLoadHook = await loadFreshUsePilotFeedResults()
      let latest: FlightFeedResults | undefined
      render(
        <FeedHarness useHook={secondLoadHook} pilotIds={[PILOT_ID]} onResults={(results) => (latest = results)} />,
      )
      await waitFor(() => expect(latest?.isLoading).toBe(false))

      expect(latest?.entries[0]?.hasTrack).toBe(false) // sanity: this load genuinely has no resolved track for it
      expect(latest?.entries[0]?.newness).toBe('not-new')
    },
  )
})

const SEEN_TRIP_KEY = 'flight-log:seen-untracked-trips'

function untrackedFlightBody(tripId: number): RecentFlightsSuccessBody {
  return {
    pilot,
    flights: [
      {
        tripId,
        userId: PILOT_ID,
        date: '2026-05-23',
        country: null,
        takeoff: 'Voss',
        glider: null,
        duration: '1:30',
        flightCount: 1,
        distanceKm: 20,
        openDistanceKm: null,
        note: null,
      },
    ],
    trackedTrips: [], // no track uploaded — this is what makes the flight untracked
  }
}

describe('usePilotFeedResults — seen-trip-store wiring for UNTRACKED flights (#62)', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    window.localStorage.clear()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('records an untracked flight as seen once it has rendered, without touching flightlog.org again', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(untrackedFlightBody(991729))) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} />)

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(SEEN_TRIP_KEY) ?? '{}')
      expect(stored).toEqual({ [PILOT_ID]: [991729] })
    })
  })

  it('classifies an untracked flight against the seen-trip set as it stood BEFORE this load replaces it, and only then records it — same ordering guarantee as the watermark (blocking finding #2, applied to #62)', async () => {
    // A DIFFERENT trip id already recorded, seeded BEFORE the hook mounts — proves the fetched
    // flight (991729) is genuinely absent from the pilot's remembered set at load time.
    window.localStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ [PILOT_ID]: [1] }))
    globalThis.fetch = vi.fn(async () => jsonResponse(untrackedFlightBody(991729))) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} onResults={(results) => (latest = results)} />)

    await waitFor(() => expect(latest?.isLoading).toBe(false))

    // Assertion 1 — the untracked flight was never in the pilot's remembered set at load
    // time, so it must classify 'new', not 'not-new'.
    expect(latest?.entries[0]?.newness).toBe('new')

    // Assertion 2 — the seen-trip set is replaced afterward to include it (see
    // replaceSeenTripIds: still-in-scope previous ids ∪ this load's rendered ids). The OLD id
    // (1) is dropped, not carried forward: it is outside this load's fetched scope (this pilot's
    // only fetched flight this load is 991729), and replaceSeenTripIds prunes anything that has
    // aged out of scope rather than keeping it forever (a pure union would have kept it).
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(SEEN_TRIP_KEY) ?? '{}')
      expect(stored).toEqual({ [PILOT_ID]: [991729] })
    })
  })

  it("classifies an untracked flight as 'not-new' when its trip id IS already in the pilot's seen-trip set at load time (blocking finding #3: severing the getSeenTripIds read — hardcoding seenTripIdsAtLoad to null — left this path with zero hook-level coverage; every existing assertion here seeded a DIFFERENT id and expected 'new', which a severed read also produces)", async () => {
    window.localStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ [PILOT_ID]: [991729] }))
    globalThis.fetch = vi.fn(async () => jsonResponse(untrackedFlightBody(991729))) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} onResults={(results) => (latest = results)} />)

    await waitFor(() => expect(latest?.isLoading).toBe(false))
    expect(latest?.entries[0]?.newness).toBe('not-new')
  })

  it("records only the RENDERED subset of a pilot's fetched untracked flights as seen, not every fetched one (blocking finding #2: recordSeenTripIds's fetchedTripIds/renderedTripIds arguments must come from two genuinely different sources — the existing truncation test only varies whether a whole PILOT contributes zero rendered entries, never the id subset WITHIN one pilot who renders some but not all)", async () => {
    const busyPilotId = 61
    const busyPilot: Pilot = { userId: busyPilotId, name: 'Busy Pilot', country: null, club: null }

    // 29 very recent, tracked flights from a busy pilot — enough to fill 29 of FEED_SIZE's 30
    // slots, leaving exactly one slot for the single newest flight from anyone else.
    const busyFlights = Array.from({ length: 29 }, (_, index) => ({
      tripId: 1000 + index,
      userId: busyPilotId,
      date: `2026-06-${String(29 - (index % 27)).padStart(2, '0')}`,
      country: null,
      takeoff: null,
      glider: null,
      duration: '1:00',
      flightCount: 1,
      distanceKm: 10,
      openDistanceKm: null,
      note: null,
    }))
    const busyBody: RecentFlightsSuccessBody = {
      pilot: busyPilot,
      flights: busyFlights,
      trackedTrips: busyFlights.map((f) => ({ tripId: f.tripId, updatedAt: '20260601000000' })),
    }

    // This pilot's own 5 untracked flights: 4 old ones that lose out to busyPilot's flights for
    // the single remaining feed slot, and 1 newer than all of them that wins it. All 5 are
    // fetched (part of this pilot's RECENT_FLIGHTS_PER_PILOT slice); only tripId 3005 renders.
    const oldUntrackedFlights = Array.from({ length: 4 }, (_, index) => ({
      tripId: 3001 + index,
      userId: PILOT_ID,
      date: `2020-01-0${index + 1}`,
      country: null,
      takeoff: null,
      glider: null,
      duration: '1:00',
      flightCount: 1,
      distanceKm: 10,
      openDistanceKm: null,
      note: null,
    }))
    const rendersFlight = {
      tripId: 3005,
      userId: PILOT_ID,
      date: '2026-07-01', // newer than every busyFlights date above
      country: null,
      takeoff: null,
      glider: null,
      duration: '1:00',
      flightCount: 1,
      distanceKm: 10,
      openDistanceKm: null,
      note: null,
    }
    const quietBody: RecentFlightsSuccessBody = {
      pilot,
      flights: [...oldUntrackedFlights, rendersFlight],
      trackedTrips: [], // every one of this pilot's flights is untracked
    }

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/${busyPilotId}/`)) return jsonResponse(busyBody)
      if (url.includes(`/${PILOT_ID}/`)) return jsonResponse(quietBody)
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(
      <FeedHarness useHook={useHook} pilotIds={[busyPilotId, PILOT_ID]} onResults={(results) => (latest = results)} />,
    )

    await waitFor(() => expect(latest?.isLoading).toBe(false))
    // Sanity: exactly one of this pilot's 5 fetched flights actually rendered.
    expect(latest?.entries.filter((entry) => entry.pilot.userId === PILOT_ID).map((entry) => entry.flight.tripId)).toEqual([3005])

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(SEEN_TRIP_KEY) ?? '{}')
      // A mutant reusing the fetched scope as the rendered set (or vice versa) would persist
      // all 5 ids here instead of just the one that actually rendered.
      expect(stored[PILOT_ID]).toEqual([3005])
    })
  })

  it('does NOT record an untracked flight that was fetched but truncated out of the merged feed by another pilot\'s newer flights — the same trap #5 found for watermarks (blocking finding #1), applied to seen-trip-store', async () => {
    const busyPilotId = 61
    const busyPilot: Pilot = { userId: busyPilotId, name: 'Busy Pilot', country: null, club: null }
    const quietPilotId = 62
    const quietPilot: Pilot = { userId: quietPilotId, name: 'Quiet Pilot', country: null, club: null }

    const busyFlights = Array.from({ length: 30 }, (_, index) => ({
      tripId: 1000 + index,
      userId: busyPilotId,
      date: `2026-06-${String(30 - (index % 28)).padStart(2, '0')}`,
      country: null,
      takeoff: null,
      glider: null,
      duration: '1:00',
      flightCount: 1,
      distanceKm: 10,
      openDistanceKm: null,
      note: null,
    }))
    const busyBody: RecentFlightsSuccessBody = {
      pilot: busyPilot,
      flights: busyFlights,
      trackedTrips: busyFlights.map((f) => ({ tripId: f.tripId, updatedAt: '20260601000000' })),
    }
    // quietPilot's single flight is UNTRACKED (no trackedTrips entry) and far older than
    // every one of busyPilot's 30 flights, so it gets truncated out of the merged feed
    // entirely by FEED_SIZE.
    const quietBody: RecentFlightsSuccessBody = {
      pilot: quietPilot,
      flights: [
        {
          tripId: 2000,
          userId: quietPilotId,
          date: '2020-01-01',
          country: null,
          takeoff: null,
          glider: null,
          duration: '1:00',
          flightCount: 1,
          distanceKm: 10,
          openDistanceKm: null,
          note: null,
        },
      ],
      trackedTrips: [],
    }

    // Seed quietPilot with a STALE entry — a trip id (9999) that is NOT among their fetched
    // flights this load (their only fetched flight is 2000). If the pilot is genuinely left
    // untouched (they contribute zero rendered entries), this stale entry survives byte-for-
    // byte, since nothing ever calls recordSeenTripIds for them. A mutant that iterates
    // every FETCHED pilot instead of every SHOWN one would still call recordSeenTripIds for
    // quietPilot (with fetchedTripIds={2000}, renderedTripIds={}) — replaceSeenTripIds would
    // then prune 9999 away (it's not in the fetched scope) and persist an empty/deleted entry,
    // which this test can observe as a CHANGE, unlike asserting only "no entry exists" from a
    // pilot who had none to begin with.
    window.localStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ [quietPilotId]: [9999] }))

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/${busyPilotId}/`)) return jsonResponse(busyBody)
      if (url.includes(`/${quietPilotId}/`)) return jsonResponse(quietBody)
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    let latest: FlightFeedResults | undefined
    render(<FeedHarness useHook={useHook} pilotIds={[busyPilotId, quietPilotId]} onResults={(results) => (latest = results)} />)

    await waitFor(() => expect(latest?.isLoading).toBe(false))
    expect(latest?.entries.some((entry) => entry.pilot.userId === quietPilotId)).toBe(false)

    // Give the recordSeenTripIds loop a chance to run (it fires in the same .finally() as
    // the watermark advance, which the busy pilot's tracked flights DO trigger).
    await waitFor(() => {
      expect(window.localStorage.getItem('flight-log:track-watermarks')).not.toBeNull()
    })
    expect(JSON.parse(window.localStorage.getItem(SEEN_TRIP_KEY) ?? '{}')[quietPilotId]).toEqual([9999])
  })

  it('does NOT wipe a pilot\'s seen-trip set when their fetch fails (the second trap #62 calls out — #5 already got this right for watermarks)', async () => {
    window.localStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ [PILOT_ID]: [1, 2, 3] }))
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 502 })) as unknown as typeof fetch
    const useHook = await loadFreshUsePilotFeedResults()

    render(<FeedHarness useHook={useHook} pilotIds={[PILOT_ID]} />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(JSON.parse(window.localStorage.getItem(SEEN_TRIP_KEY) ?? '{}')).toEqual({ [PILOT_ID]: [1, 2, 3] })
  })
})
