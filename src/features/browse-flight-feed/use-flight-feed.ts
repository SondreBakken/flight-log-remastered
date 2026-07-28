'use client'

import { useEffect, useState } from 'react'
import { runWithConcurrencyLimit, type Settled } from '@/lib/concurrency/with-limit'
import { getWatermark, recordSeen } from '@/lib/watermark-store/storage'
import { fetchPilotFeed } from './fetch-pilot-feed'
import {
  buildFeedEntries,
  failedPilotResults,
  FEED_SIZE,
  maxTrackedTs,
  type FeedEntry,
  type PilotFeedFailure,
  type PilotFeedResult,
} from './feed'

// Low single digits: enough that a fast pilot doesn't sit queued behind a slow one, far
// below the ~200-requests-in-a-few-minutes threshold that silently kills a flightlog.org
// session (docs/flightlog-api.md). Each in-flight request now also costs at most
// MAX_YEARS_PER_PILOT track-index requests, by construction (see sliceRecentFlights), so
// the cap exists to smooth out request timing, not to protect against per-request cost.
// Exported so check-feed.mts can pin the production value rather than a test-local guess.
export const CONCURRENCY_LIMIT = 4

// fetchPilotFeed never rejects on its own (it has its own try/catch), but the limiter is a
// generic utility that does not assume that — this turns whatever it hands back into the
// PilotFeedResult this hook actually needs, converting an unexpected rejection into a
// failure entry instead of losing it.
function toPilotFeedResult(pilotId: number, outcome: Settled<PilotFeedResult>): PilotFeedResult {
  if (outcome.ok) return outcome.value
  return {
    status: 'error',
    pilotId,
    message: outcome.error instanceof Error ? outcome.error.message : `failed to load pilot ${pilotId}`,
  }
}

export type FlightFeedResults = {
  isLoading: boolean
  entries: FeedEntry[]
  failedPilots: PilotFeedFailure[]
}

// Assumes `pilotIds` is non-empty and stable for the component instance's lifetime: the
// caller (FlightFeed) remounts this hook's owner via a `key` derived from the followed-id
// set whenever that set changes, rather than this hook resetting its own state in
// response to a changed dependency — an effect resetting state to synchronize with a
// prop is exactly the anti-pattern react-hooks/set-state-in-effect flags. A fresh mount
// giving every state variable a fresh initial value is the recommended replacement (see
// https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes).
export function usePilotFeedResults(pilotIds: number[]): FlightFeedResults {
  const [results, setResults] = useState<PilotFeedResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Each pilot's watermark AS IT STOOD the instant that pilot's own fetch settled, captured
  // in the onSettled callback below BEFORE recordSeen (same callback, right after) advances
  // it — otherwise "new" would be computed against the watermark this very load just moved,
  // and nothing would ever render as new. State, not a ref: React (with the compiler enabled
  // here) disallows reading a ref's value during render (react-hooks/refs), and this value IS
  // read during render, below, to classify each entry's newness.
  const [watermarksAtLoad, setWatermarksAtLoad] = useState(new Map<number, string | null>())

  useEffect(() => {
    let cancelled = false
    // Aborts every pilot still in flight when this effect is cleaned up (follow list
    // changed, component unmounted) — without this, an abandoned fetch keeps running to
    // completion, wasting a request and a worker slot the pool could hand to a pilot that
    // actually matters. `cancelled` alone only suppressed the resulting setState, it never
    // stopped the request itself.
    const controller = new AbortController()

    runWithConcurrencyLimit(
      pilotIds,
      CONCURRENCY_LIMIT,
      (pilotId) => fetchPilotFeed(pilotId, controller.signal),
      (pilotId, outcome) => {
        if (cancelled) return
        const result = toPilotFeedResult(pilotId, outcome)
        if (result.status === 'success') {
          // "The user has seen the feed" for THIS pilot means: their own fetch resolved and
          // is about to render. Advancing right here (not once the whole feed finishes
          // loading) means a pilot whose fetch is slow doesn't hold up every other pilot's
          // watermark — and never happens on any cadence but this one, on-load, effect run.
          //
          // Read (getWatermark) then write (recordSeen) happen here, OUTSIDE the setState
          // updater below — a state updater must stay pure, and recordSeen is a real
          // localStorage write, not a value derivation.
          const watermarkAtLoad = getWatermark(pilotId)
          setWatermarksAtLoad((previous) => new Map(previous).set(pilotId, watermarkAtLoad))
          const candidateTs = maxTrackedTs(result.trackedTrips)
          if (candidateTs !== null) recordSeen(pilotId, candidateTs)
        }
        setResults((previous) => [...previous, result])
      },
    )
      .catch((error: unknown) => {
        // runWithConcurrencyLimit only rejects synchronously, before any pilot fetch
        // starts (an invalid CONCURRENCY_LIMIT) — reachable only by a future regression,
        // but a rejected promise with no .catch() is a real unhandled rejection in the
        // browser, so this stays even though CONCURRENCY_LIMIT is a hardcoded constant.
        if (!cancelled) console.error('flight feed: concurrency pool failed', error)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // pilotIds is frozen for this mount by construction (see doc comment above), so this
    // intentionally runs once per mount rather than re-running if the caller ever passed a
    // new array instance with the same ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    isLoading,
    entries: buildFeedEntries(results, FEED_SIZE, watermarksAtLoad),
    failedPilots: failedPilotResults(results),
  }
}
