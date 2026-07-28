import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { RecentFlightsSuccessBody } from '@/app/api/pilots/[userId]/recent-flights/contract'
import type { Pilot } from '@/lib/flightlog/types'
import type { usePilotFeedResults as UsePilotFeedResults, FlightFeedResults } from './use-flight-feed'

// This file exercises the actual WIRING in usePilotFeedResults — not just the pure pieces
// (feed.ts's classifyNewness, watermark-store's advanceWatermark) that feed.test.ts and
// watermark-ids.test.ts already cover in isolation. Those pure-function tests cannot catch a
// regression where the hook reads or writes the watermark at the wrong point, or forgets to
// advance it at all.
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
    // already equal to the flight's own ts, classifyNewness's strict `>` would call it
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
})
