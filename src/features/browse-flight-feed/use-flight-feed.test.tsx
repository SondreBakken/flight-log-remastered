import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { RecentFlightsSuccessBody } from '@/app/api/pilots/[userId]/recent-flights/contract'
import type { Pilot } from '@/lib/flightlog/types'
import { usePilotFeedResults } from './use-flight-feed'

// This file exercises the actual WIRING in usePilotFeedResults — not just the pure pieces
// (feed.ts's maxTrackedTs/classifyNewness, watermark-store's advanceWatermark) that
// feed.test.ts and watermark-ids.test.ts already cover in isolation. Those pure-function
// tests cannot catch a regression where the hook reads or writes the watermark at the wrong
// point, or forgets to call recordSeen at all — only actually running the hook's effect
// against a stubbed fetch and inspecting localStorage afterward proves that.

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

// A minimal harness — usePilotFeedResults has no meaningful return value to assert on here,
// only its localStorage side effect (see the test below), so the harness just needs to mount
// the hook and let its effect run.
function FeedHarness({ pilotIds }: { pilotIds: number[] }) {
  usePilotFeedResults(pilotIds)
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

    render(<FeedHarness pilotIds={[PILOT_ID]} />)

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WATERMARK_KEY) ?? '{}')
      expect(stored).toEqual({ [PILOT_ID]: '20260523164423' })
    })
  })

  it('does NOT advance the watermark for a pilot whose feed load fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 502 })) as unknown as typeof fetch

    render(<FeedHarness pilotIds={[PILOT_ID]} />)

    // Give the failing fetch a chance to settle, then confirm nothing was ever written.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(window.localStorage.getItem(WATERMARK_KEY)).toBeNull()
  })
})
