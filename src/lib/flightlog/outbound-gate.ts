// Deliberately WITHOUT 'server-only': http.ts (which does carry that guard) imports the
// gate instance from here, but scripts/check-request-gate.mts also needs to import these
// constants under plain tsx, which 'server-only' throws under unconditionally. Mirrors the
// existing split between browse-flight-feed's pure feed.ts and its client-only route.
import { createRequestGate, type RequestGate } from '@/lib/concurrency/request-gate'

// CAVEAT for whoever resizes this: this state lives in one module instance. On Vercel,
// module state is per function instance, and instances scale out under load — four
// concurrent route invocations can land on four separate instances, each running its own
// gate independently starting from zero. This bounds outbound concurrency and pacing PER
// INSTANCE, not app-wide; it is not a global rate limiter, and sizing it up "to be safe"
// does not change that ceiling.

// Sized against the two concurrency knobs already established in this codebase for the
// same traffic-safety reason (use-flight-feed.ts's CONCURRENCY_LIMIT and tracks.ts's
// YEAR_FETCH_CONCURRENCY, both 4, both reasoned as "low single digits — enough that a fast
// [pilot/year] doesn't queue behind a slow one"). A single feed pilot's common-case fan-out
// through http.ts is 1 logbook fetch, then (once MAX_YEARS_PER_PILOT track-year fetches are
// underway) up to 2 more, concurrently — 4 lets that single pilot's own fan-out clear
// without forcing its 2 track fetches to serialise against each other, while still bounding
// the instance to a small, deliberately-chosen number rather than nothing at all.
export const REQUEST_GATE_LIMIT = 4

// A floor under how fast a freed slot can be reused, not a rate limit — the property the
// documented incident actually needed. The burst that killed a session (docs/flightlog-api
// .md) was already paced at roughly 400ms/request and was flagged for its PATTERN (a fixed
// Referer, varying only `a=`), not its speed; Referer variation and the 10-minute session
// lifetime (both already in http.ts) are what target that. This spacing only stops several
// slots freeing in the same tick — e.g. two track-year fetches completing together — from
// firing their queued replacements in that same tick too.
//
// Kept small because it is paid by every real page load: a full 4-pilot feed load (see
// use-flight-feed.ts's CONCURRENCY_LIMIT) drives up to ~12 raw fetches through this one
// gate in its common case (4 pilots x [1 logbook + 2 track-year fetches]). Dispatching N
// requests through a spacing floor costs at least (N-1) x this value regardless of how many
// run concurrently, so at 50ms that's at most 11 x 50ms = 550ms added to fully DISPATCH a
// full feed load — well under fetch-pilot-feed.ts's existing 15s client-side ceiling, and
// small next to the real network round-trips that dominate the rest of that load anyway.
// This 12-fetch common case omits the session mint and the re-mint+retry path (http.ts):
// a session gate on every one of a load's raw fetches would drive one logical
// fetchFlightlog call to as many as 4 gated calls (mint, first attempt, re-mint, retry),
// worst-casing nearer 48 gated fetches and ~2350ms of spacing — the conclusion (well under
// 15s) still holds, since that worst case is already a total-outage scenario.
export const REQUEST_GATE_MIN_SPACING_MS = 50

// Without this, a connection flightlog.org accepts and never answers hangs until the
// platform kills the function. 8s bounds how long an ADMITTED task may run — the clock
// starts at admission, not arrival, so queue wait ahead of it is unbounded. A feed load
// pushes up to 12 gated fetches through 4 slots by construction (REQUEST_GATE_LIMIT,
// use-flight-feed.ts's CONCURRENCY_LIMIT x [1 logbook + MAX_YEARS_PER_PILOT track
// fetches]), so a request queued behind several hung ones can still blow past
// fetch-pilot-feed.ts's 15s client-side ceiling before this timeout ever fires for it —
// this is a per-admitted-task hang-prevention ceiling, not a bound on one caller's total
// latency, and it is strictly better than today's fully unbounded hang either way.
export const REQUEST_GATE_TIMEOUT_MS = 8_000

// One shared gate for every raw fetch() to flightlog.org — both the session mint and the
// data request in http.ts are wrapped through this single instance today. Nothing enforces
// that; a future raw fetch added to that file could bypass it — this only guarantees that
// today's two call sites don't.
export const flightlogRequestGate: RequestGate = createRequestGate({
  limit: REQUEST_GATE_LIMIT,
  minSpacingMs: REQUEST_GATE_MIN_SPACING_MS,
  timeoutMs: REQUEST_GATE_TIMEOUT_MS,
})

export type GatedFetchResult = {
  readonly status: number
  readonly ok: boolean
  readonly headers: Headers
  readonly text: string
}

// The only place a raw fetch() to flightlog.org is allowed to happen (enforced for
// src/lib/flightlog/http.ts by the no-restricted-globals rule scoped to it in
// eslint.config.mjs). Both http.ts call sites become one-line callers of this, which is
// what makes the gate's real behaviour — slot acquisition, timeout, and the body read that
// must happen INSIDE the slot (see requestOnce's old doc comment, now here) — directly
// testable with a stubbed global fetch, instead of living entirely behind 'server-only'.
//
// `gate` defaults to the production singleton, so http.ts's two call sites (which never
// pass it) always run through the real limit/spacing/timeout. Tests inject a fake-clock
// gate instead — asserting a real 8s timeout would mean actually waiting 8 real seconds
// every check run, which a fake clock avoids without weakening what gets asserted.
export function gatedFetch(
  url: string,
  init: RequestInit,
  gate: RequestGate = flightlogRequestGate,
): Promise<GatedFetchResult> {
  return gate.run(async (signal) => {
    const response = await fetch(url, { ...init, signal })
    return { status: response.status, ok: response.ok, headers: response.headers, text: await response.text() }
  })
}
