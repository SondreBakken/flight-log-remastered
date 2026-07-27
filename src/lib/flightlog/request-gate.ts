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
export const REQUEST_GATE_MIN_SPACING_MS = 50

// There is currently NO timeout anywhere between this app and flightlog.org: if the site
// accepts a connection and never answers, the call hangs until the platform kills the
// function. 8s is chosen to be well short of fetch-pilot-feed.ts's own FETCH_TIMEOUT_MS
// (15_000ms, the browser's ceiling on one full route-handler round trip): a single hung
// upstream connection fails HERE first, so the route handler's own try/catch
// (api/pilots/[userId]/recent-flights/route.ts) gets the chance to return its normal, clean
// 502 instead of the browser's timeout cutting the connection first with a generic
// client-side message. This is purely a hang-prevention ceiling, not a traffic-pattern
// defence — a pathological case where every stage of one call times out in sequence (mint,
// then data, then a re-mint, then a re-data) can still exceed the browser's 15s ceiling; that
// is an acceptable outcome for what is already a total-outage scenario, and strictly better
// than today's unbounded hang.
export const REQUEST_GATE_TIMEOUT_MS = 8_000

// One shared gate for every raw fetch() to flightlog.org — both the session mint and the
// data request in http.ts funnel through this single instance, so no caller, present or
// future, can bypass it by adding a new raw fetch to that file.
export const flightlogRequestGate: RequestGate = createRequestGate({
  limit: REQUEST_GATE_LIMIT,
  minSpacingMs: REQUEST_GATE_MIN_SPACING_MS,
  timeoutMs: REQUEST_GATE_TIMEOUT_MS,
})
