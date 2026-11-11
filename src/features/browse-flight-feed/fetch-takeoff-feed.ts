import { parseTakeoffRecentFlightsBody } from '@/app/api/countries/[countryId]/takeoffs/[takeoffId]/recent-flights/contract'
import type { TakeoffRef } from '@/lib/flightlog/types'
import type { TakeoffFeedResult } from './feed'

// Same ceiling and reason as fetch-pilot-feed.ts: a takeoff whose request never resolves must not
// hold its concurrency-pool worker forever.
const FETCH_TIMEOUT_MS = 15_000

function describe({ countryId, takeoffId }: TakeoffRef): string {
  return `takeoff ${countryId}/${takeoffId}`
}

// Every failure message is generic and ours: the route never forwards upstream text, and a
// browser-side failure carries none worth showing.
function browserFailureMessage(takeoff: TakeoffRef, error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `${describe(takeoff)}: timed out waiting for a response`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `${describe(takeoff)}: request was cancelled`
  }
  return `${describe(takeoff)}: request failed`
}

function abortSignalFor(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

// Infra, the takeoff twin of fetchPilotFeed: talks to our own route handler and reports success
// or failure, never throws. A 404 (a stored follow whose takeoff no longer exists) is reported as
// a failure like any other, so the feed shows it in the failed-takeoffs notice.
export async function fetchTakeoffFeed(takeoff: TakeoffRef, signal?: AbortSignal): Promise<TakeoffFeedResult> {
  const { countryId, takeoffId } = takeoff
  try {
    const response = await fetch(`/api/countries/${countryId}/takeoffs/${takeoffId}/recent-flights`, {
      signal: abortSignalFor(signal),
    })
    if (!response.ok) {
      return { status: 'error', countryId, takeoffId, message: `${describe(takeoff)}: request failed with status ${response.status}` }
    }
    const parsed = parseTakeoffRecentFlightsBody(await response.json())
    if (parsed === null) {
      return { status: 'error', countryId, takeoffId, message: `${describe(takeoff)}: malformed response` }
    }
    return { status: 'success', takeoff: parsed.takeoff, flights: parsed.flights }
  } catch (error) {
    return { status: 'error', countryId, takeoffId, message: browserFailureMessage(takeoff, error) }
  }
}
