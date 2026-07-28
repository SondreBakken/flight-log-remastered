'use client'

import { useEffect, useState } from 'react'
import { runWithConcurrencyLimit, type Settled } from '@/lib/concurrency/with-limit'
import { getWatermark, recordSeen } from '@/lib/watermark-store/storage'
import { fetchPilotFeed } from './fetch-pilot-feed'
import {
  anyPilotHasPriorWatermark,
  buildFeedEntries,
  failedPilotResults,
  FEED_SIZE,
  shownTrackedTsByPilot,
  type FeedEntry,
  type FetchedPilotFeedResult,
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
function toFetchedResult(pilotId: number, outcome: Settled<FetchedPilotFeedResult>): FetchedPilotFeedResult {
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
  // Whether any followed pilot had a watermark recorded before this load — see
  // anyPilotHasPriorWatermark. Lets the caption distinguish a genuine first visit (nothing to
  // report "since your last visit" against) from an established one.
  hasSeenBefore: boolean
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

  useEffect(() => {
    let cancelled = false
    // Aborts every pilot still in flight when this effect is cleaned up (follow list
    // changed, component unmounted) — without this, an abandoned fetch keeps running to
    // completion, wasting a request and a worker slot the pool could hand to a pilot that
    // actually matters. `cancelled` alone only suppressed the resulting setState, it never
    // stopped the request itself.
    const controller = new AbortController()
    // Mirrors `results` exactly (same pushes, same order) but owned by this effect run
    // rather than React state, so the watermark advance below can read the FINAL collected
    // results synchronously once every pilot has settled, without racing a setState that
    // may not have committed yet.
    const collected: PilotFeedResult[] = []

    runWithConcurrencyLimit(
      pilotIds,
      CONCURRENCY_LIMIT,
      (pilotId) => fetchPilotFeed(pilotId, controller.signal),
      (pilotId, outcome) => {
        if (cancelled) return
        const fetched = toFetchedResult(pilotId, outcome)
        // Read (getWatermark), not write: the write side — advancing this pilot's stored
        // watermark — happens once, below, only after every pilot has settled AND only for
        // flights that actually end up rendered (see the .finally() block and blocking
        // finding #1: advancing here, per pilot, over every flight FETCHED silently marked
        // flights the user never saw as seen forever, with no undo).
        const result: PilotFeedResult =
          fetched.status === 'success' ? { ...fetched, watermarkAtLoad: getWatermark(pilotId) } : fetched
        collected.push(result)
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
        if (cancelled) return
        // "The user has seen this flight" can only honestly mean a flight that made it into
        // the merged, FEED_SIZE-truncated feed actually rendered — see shownTrackedTsByPilot.
        // Advancing once here (not per pilot, on each fetch settling) trades a slow pilot
        // briefly holding up every watermark's advance for correctness: a watermark that
        // silently swallows an unseen flight, with no undo, is worse than one that advances a
        // moment later once the whole load has actually settled.
        const shownEntries = buildFeedEntries(collected, FEED_SIZE)
        for (const [pilotId, ts] of shownTrackedTsByPilot(shownEntries)) recordSeen(pilotId, ts)
        setIsLoading(false)
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
    entries: buildFeedEntries(results, FEED_SIZE),
    failedPilots: failedPilotResults(results),
    hasSeenBefore: anyPilotHasPriorWatermark(results),
  }
}
