import type { Flight, Pilot } from '@/lib/flightlog/types'
import type { PilotFeedResult } from './feed'

type RecentFlightsResponseBody = {
  pilot: Pilot
  flights: Flight[]
  trackedTripIds: number[]
}

function messageFor(status: number, body: unknown): string {
  const parsed = body as { error?: string } | null
  return parsed?.error ?? `flightlog.org returned ${status}`
}

// Infra: talks to our own route handler over HTTP and reports what happened, success or
// failure — the merge/sort/slice logic that turns many of these into one feed lives in
// feed.ts and never touches fetch itself.
export async function fetchPilotFeed(pilotId: number): Promise<PilotFeedResult> {
  try {
    const response = await fetch(`/api/pilots/${pilotId}/recent-flights`)
    const body = await response.json()
    if (!response.ok) {
      return { status: 'error', pilotId, message: messageFor(response.status, body) }
    }
    const { pilot, flights, trackedTripIds } = body as RecentFlightsResponseBody
    return { status: 'success', pilotId, pilot, flights, trackedTripIds }
  } catch (error) {
    return {
      status: 'error',
      pilotId,
      message: error instanceof Error ? error.message : `failed to load pilot ${pilotId}`,
    }
  }
}
