'use client'

import { useEffect, useState } from 'react'
import { runWithConcurrencyLimit, type Settled } from '@/lib/concurrency/with-limit'
import { getWatermark, recordSeen } from '@/lib/watermark-store/storage'
import { getSeenTripIds, recordSeenTripIds } from '@/lib/seen-trip-store/storage'
import { fetchPilotFeed } from './fetch-pilot-feed'
import { fetchTakeoffFeed } from './fetch-takeoff-feed'
import type { TakeoffRef } from '@/lib/flightlog/types'
import {
  anyPilotHasPriorVisit,
  buildFeedEntries,
  failedPilotResults,
  failedTakeoffResults,
  FEED_SIZE,
  fetchedTripIdsByPilot,
  shownTrackedTsByPilot,
  shownTripIdsByPilot,
  type FeedEntry,
  type FetchedPilotFeedResult,
  type PilotFeedFailure,
  type PilotFeedResult,
  type TakeoffFeedFailure,
  type TakeoffFeedResult,
} from './feed'

// Low single digits: enough that a fast pilot doesn't sit queued behind a slow one, far
// below the ~200-requests-in-a-few-minutes threshold that silently kills a flightlog.org
// session (docs/flightlog-api.md). Each in-flight request now also costs at most
// MAX_YEARS_PER_PILOT track-index requests, by construction (see sliceRecentFlights), so
// the cap exists to smooth out request timing, not to protect against per-request cost.
// Exported so check-feed.mts can pin the production value rather than a test-local guess.
export const CONCURRENCY_LIMIT = 4

// One unit of work for the shared concurrency limiter: a followed pilot or a followed takeoff.
// They share CONCURRENCY_LIMIT, since both cost requests against the same upstream.
type FeedTask = { kind: 'pilot'; pilotId: number } | { kind: 'takeoff'; takeoff: TakeoffRef }

// What a settled task hands back, tagged so onSettled can tell the two result types apart
// without a cast.
type TaskResult =
  | { kind: 'pilot'; result: FetchedPilotFeedResult }
  | { kind: 'takeoff'; result: TakeoffFeedResult }

async function fetchTask(task: FeedTask, signal: AbortSignal): Promise<TaskResult> {
  if (task.kind === 'pilot') return { kind: 'pilot', result: await fetchPilotFeed(task.pilotId, signal) }
  return { kind: 'takeoff', result: await fetchTakeoffFeed(task.takeoff, signal) }
}

// fetchPilotFeed and fetchTakeoffFeed never reject on their own (each has its own try/catch), but
// the limiter is a generic utility that does not assume that — this turns whatever it hands back
// into the TaskResult this hook actually needs, converting an unexpected rejection into a failure
// entry instead of losing it.
function toTaskResult(task: FeedTask, outcome: Settled<TaskResult>): TaskResult {
  if (outcome.ok) return outcome.value
  const reason = outcome.error instanceof Error ? outcome.error.message : undefined
  if (task.kind === 'pilot') {
    const { pilotId } = task
    return { kind: 'pilot', result: { status: 'error', pilotId, message: reason ?? `failed to load pilot ${pilotId}` } }
  }
  const { countryId, takeoffId } = task.takeoff
  return {
    kind: 'takeoff',
    result: { status: 'error', countryId, takeoffId, message: reason ?? `failed to load takeoff ${countryId}/${takeoffId}` },
  }
}

// "The user has seen this flight" can only honestly mean a flight that made it into the merged,
// FEED_SIZE-truncated feed actually rendered — see shownTrackedTsByPilot (watermark) and
// shownTripIdsByPilot (id memory) for the two stores this advances/replaces, both scoped to
// rendered entries only, never every flight fetched (blocking finding #1's trap, and #62's
// extension of it to id memory). The one place both stores move forward for a completed load.
//
// Site-sourced entries (viaTakeoff) are filtered out first: the pilot on such a row may not be
// followed, so there is no pilot-keyed state to advance and no fetched scope to find for them
// (the guard below would throw). A pilot-sourced entry that won a dedupe against a site row has no
// viaTakeoff and is remembered as usual.
function rememberWhatWasShown(collected: readonly PilotFeedResult[], allShownEntries: readonly FeedEntry[]): void {
  const shownEntries = allShownEntries.filter((entry) => entry.viaTakeoff === undefined)
  for (const [pilotId, ts] of shownTrackedTsByPilot(shownEntries)) recordSeen(pilotId, ts)

  // fetchedTripIds always has an entry for every pilot shownTripIds could possibly name: both
  // are derived from the same `collected`/`shownEntries` pair, and a flight can only render for
  // a pilot whose own fetch succeeded (see fetchedTripIdsByPilot/shownTripIdsByPilot's own doc
  // comments). A missing entry here would mean that invariant broke, not a case to paper over
  // with a silent empty-Set fallback (blocking finding #4) — better a loud failure than quietly
  // replacing this pilot's whole remembered set with only what rendered this load.
  const fetchedTripIds = fetchedTripIdsByPilot(collected)
  for (const [pilotId, renderedTripIds] of shownTripIdsByPilot(shownEntries)) {
    const fetchedForPilot = fetchedTripIds.get(pilotId)
    if (fetchedForPilot === undefined) {
      throw new Error(
        `seen-trip-store: pilot ${pilotId} rendered an entry with no fetched scope recorded — every successful pilot gets one from fetchedTripIdsByPilot, so this should be unreachable`,
      )
    }
    recordSeenTripIds(pilotId, { fetchedTripIds: fetchedForPilot, renderedTripIds })
  }
}

export type FlightFeedResults = {
  isLoading: boolean
  entries: FeedEntry[]
  failedPilots: PilotFeedFailure[]
  failedTakeoffs: TakeoffFeedFailure[]
  // Whether any followed pilot had a watermark OR a seen-trip entry recorded before this load
  // — see anyPilotHasPriorVisit. Lets the caption distinguish a genuine first visit (nothing to
  // report "since your last visit" against) from an established one.
  hasSeenBefore: boolean
}

// Assumes `pilotIds` and `takeoffs` are not both empty, and stable for the component instance's
// lifetime: the caller (FlightFeed) remounts this hook's owner via a `key` derived from the
// followed pilot and takeoff sets whenever either changes, rather than this hook resetting its own state in
// response to a changed dependency — an effect resetting state to synchronize with a
// prop is exactly the anti-pattern react-hooks/set-state-in-effect flags. A fresh mount
// giving every state variable a fresh initial value is the recommended replacement (see
// https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes).
//
// A fresh mount is not the only way the effect starts, though: with cacheComponents, Next.js
// keeps a navigated-away route mounted inside React's <Activity mode="hidden">, which runs the
// effect cleanup but preserves state. Navigating back re-runs the effect against the previous
// load's `results` unless the cleanup has restored initial state — see the cleanup below.
export function useFlightFeedResults(pilotIds: number[], takeoffs: TakeoffRef[]): FlightFeedResults {
  const [results, setResults] = useState<PilotFeedResult[]>([])
  const [takeoffResults, setTakeoffResults] = useState<TakeoffFeedResult[]>([])
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
    const collectedTakeoffs: TakeoffFeedResult[] = []
    const tasks: FeedTask[] = [
      ...pilotIds.map((pilotId): FeedTask => ({ kind: 'pilot', pilotId })),
      ...takeoffs.map((takeoff): FeedTask => ({ kind: 'takeoff', takeoff })),
    ]

    runWithConcurrencyLimit(
      tasks,
      CONCURRENCY_LIMIT,
      (task) => fetchTask(task, controller.signal),
      (task, outcome) => {
        if (cancelled) return
        const settled = toTaskResult(task, outcome)
        if (settled.kind === 'takeoff') {
          collectedTakeoffs.push(settled.result)
          setTakeoffResults((previous) => [...previous, settled.result])
          return
        }
        const fetched = settled.result
        const pilotId = fetched.pilotId
        // Read (getWatermark / getSeenTripIds), not write: the write side — advancing this
        // pilot's stored watermark, and replacing their stored seen-trip set — happens once,
        // below, only after every task has settled AND only for flights that actually end up
        // rendered (see the .finally() block and blocking finding #1: advancing here, per
        // pilot, over every flight FETCHED silently marked flights the user never saw as seen
        // forever, with no undo — the same trap applies to the seen-trip store, see #62).
        const result: PilotFeedResult =
          fetched.status === 'success'
            ? { ...fetched, watermarkAtLoad: getWatermark(pilotId), seenTripIdsAtLoad: getSeenTripIds(pilotId) }
            : fetched
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
        // Advancing/replacing once here (not per pilot, on each fetch settling) trades a slow
        // pilot briefly holding up every store's update for correctness: a store that silently
        // swallows an unseen flight, with no undo, is worse than one that updates a moment later
        // once the whole load has actually settled. See rememberWhatWasShown for the "only
        // rendered entries count" rule this applies to both stores.
        rememberWhatWasShown(collected, buildFeedEntries(collected, FEED_SIZE, collectedTakeoffs))
        setIsLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
      // Restores initial state so the next run (an <Activity> re-show, see doc comment above)
      // starts from empty instead of appending a second copy of every pilot. Resetting here
      // rather than at the top of the effect keeps setState out of the effect body, which
      // react-hooks/set-state-in-effect rejects. A no-op after a real unmount.
      setResults([])
      setTakeoffResults([])
      setIsLoading(true)
    }
    // pilotIds and takeoffs are frozen for this mount by construction (see doc comment above), so this
    // intentionally has no dependencies rather than re-running if the caller ever passed new
    // array instances with the same ids. It still re-runs on every <Activity> re-show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    isLoading,
    entries: buildFeedEntries(results, FEED_SIZE, takeoffResults),
    failedPilots: failedPilotResults(results),
    failedTakeoffs: failedTakeoffResults(takeoffResults),
    hasSeenBefore: anyPilotHasPriorVisit(results),
  }
}
