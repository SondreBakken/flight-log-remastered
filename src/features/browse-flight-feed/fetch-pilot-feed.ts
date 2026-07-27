import { isRecentFlightsSuccessBody } from '@/app/api/pilots/[userId]/recent-flights/contract'
import type { PilotFeedResult } from './feed'

// A pilot whose request never resolves (dead route, hung upstream) would otherwise occupy
// its concurrency-pool worker forever, stalling the rest of the feed indefinitely — see
// with-limit.ts. This is a hard ceiling on how long one pilot's slot is held.
const FETCH_TIMEOUT_MS = 15_000

function messageFor(status: number, body: unknown): string {
  const parsed = body as { error?: string } | null
  return parsed?.error ?? `flightlog.org returned ${status}`
}

// Distinct from the route handler's own error message: this covers failures on the
// browser side of the call (network loss, our own timeout, an aborted request), which
// never carry upstream detail worth showing, so there's nothing to redact — just keep the
// message generic and stable rather than exposing a raw DOMException string.
function browserFailureMessage(pilotId: number, error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `pilot ${pilotId}: timed out waiting for a response`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `pilot ${pilotId}: request was cancelled`
  }
  return `pilot ${pilotId}: request failed`
}

function abortSignalFor(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

// Infra: talks to our own route handler over HTTP and reports what happened, success or
// failure — the merge/sort/slice logic that turns many of these into one feed lives in
// feed.ts and never touches fetch itself. `signal`, when passed, lets the caller cancel an
// in-flight request (e.g. the follow list changed and this fetch is now abandoned) on top
// of the built-in timeout.
export async function fetchPilotFeed(pilotId: number, signal?: AbortSignal): Promise<PilotFeedResult> {
  try {
    const response = await fetch(`/api/pilots/${pilotId}/recent-flights`, { signal: abortSignalFor(signal) })
    const body: unknown = await response.json()
    if (!response.ok) {
      return { status: 'error', pilotId, message: messageFor(response.status, body) }
    }
    if (!isRecentFlightsSuccessBody(body)) {
      return { status: 'error', pilotId, message: `pilot ${pilotId}: malformed response` }
    }
    return { status: 'success', pilotId, pilot: body.pilot, flights: body.flights, trackedTripIds: body.trackedTripIds }
  } catch (error) {
    return { status: 'error', pilotId, message: browserFailureMessage(pilotId, error) }
  }
}
