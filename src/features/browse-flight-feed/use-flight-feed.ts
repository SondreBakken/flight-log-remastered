'use client'

import { useEffect, useState } from 'react'
import { runWithConcurrencyLimit } from '@/lib/concurrency/with-limit'
import { fetchPilotFeed } from './fetch-pilot-feed'
import { buildFeedEntries, failedPilotResults, FEED_SIZE, type FeedEntry, type PilotFeedFailure, type PilotFeedResult } from './feed'

// Low single digits: enough that a fast pilot doesn't sit queued behind a slow one, far
// below the ~200-requests-in-a-few-minutes threshold that silently kills a flightlog.org
// session (docs/flightlog-api.md). Each in-flight request is also already cheap — one or
// two years of track index per pilot, see sliceRecentFlights — so the cap exists to
// smooth out request timing, not to protect against per-request cost.
const CONCURRENCY_LIMIT = 4

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

  useEffect(() => {
    let cancelled = false

    runWithConcurrencyLimit(pilotIds, CONCURRENCY_LIMIT, fetchPilotFeed, (_pilotId, result) => {
      if (cancelled) return
      setResults((previous) => [...previous, result])
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })

    return () => {
      cancelled = true
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
  }
}
