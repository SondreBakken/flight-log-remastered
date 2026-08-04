import 'server-only'
import { postFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parsePilotSearch } from './parse-pilot-search'
import { isValidPilotId } from './types'
import type { PilotSearchResult } from './types'

const PILOT_SEARCH_ACTION = 114
const PILOT_SEARCH_PATH = `/fl.html?l=${ENGLISH}&a=${PILOT_SEARCH_ACTION}`
// The same profile action a=114 itself links every result row through (parse-pilot-search.ts's
// PROFILE_LINK_ACTION) — a=114 redirects here directly, instead of rendering a results page,
// when exactly one pilot matches (established live: q=viljar -> user_id=11348, not yet in
// docs/flightlog-api.md).
const PROFILE_ACTION = 28

// The two shapes a completed search can settle into. Kept as a discriminated union rather than
// an optional `userId` alongside `results` for the same reason ScoringGeometryResult (types.ts)
// is a union and not an optional-field bag: a single-match redirect and a results page are
// genuinely different responses from flightlog.org, and a caller checking `kind` can't
// accidentally read `results` off a single-match outcome (or vice versa) the way an all-optional
// shape would let it.
export type PilotSearchOutcome =
  | { kind: 'results'; results: PilotSearchResult[] }
  | { kind: 'single-match'; userId: number }
// The real page a browser has open when it submits this form — a=114 itself, confirmed live
// (see docs/flightlog-api.md) — not some other page in this app's own tree, mirroring
// clubs.ts's COUNTRY_INDEX_PAGE referer choice for the same reason: this is what flightlog.org
// actually sees a real client send.
const PILOT_SEARCH_PAGE_REFERER = `${FLIGHTLOG_ORIGIN}${PILOT_SEARCH_PATH}`

// Every query is implicitly substring-wrapped server side, and `_` is a live SQL LIKE
// single-character wildcard confirmed live via `H_nden` (docs/flightlog-api.md) — `%` is only
// advertised by the form's own label, never independently confirmed against a live response, but
// per SQL LIKE semantics it is the wildcard that REMOVES the adjacency requirement between
// characters: `n%d%e` matches any name containing an n, then (anywhere later) a d, then (anywhere
// later) an e, which is a vastly weaker constraint than the 3 adjacent characters in `nde`. So a
// query's real narrowing power is not "how many non-wildcard characters remain after stripping
// wildcards" — `n%d%e` and `nde` strip to the same 3 characters, but `n%d%e` is a strict superset
// of `nde` and matches far more of the table — it is the LONGEST RUN OF CONSECUTIVE, un-wildcarded
// characters, since only a run of that length actually keeps the LIKE pattern's adjacency
// requirement (and therefore its narrowing power) intact. `nde` has one run of 3. `H_nden` splits
// on `_` into `H` and `nden`, runs of 1 and 4 — the longest, 4, still clears the floor. `a%e%o`
// splits into three runs of 1. There is no server-side cap or pagination to fall back on: a
// 3-adjacent-character query (`nde`) already returns 400+ pilots in one 48KB response, and a query
// that merely strips to 3 significant characters without any of them being adjacent (`e%r%n`)
// returns most of the table. 3 is picked because it's the shortest adjacent run already verified
// live to behave like a real, if unbounded, substring search rather than a full-table dump.
export const MIN_SIGNIFICANT_QUERY_LENGTH = 3

// A generous ceiling, not a tuned one: nothing in a pilot's display name is anywhere near this
// long, so it exists only to keep a pathological input (a 100,000-character query, say) from
// producing a POST body of proportional size — the floor above is about narrowing the *result*,
// this is about bounding the *request* itself.
export const MAX_QUERY_LENGTH = 100

// Splitting on the wildcard characters yields exactly the runs of adjacent literal characters
// the pattern preserves; trimming each run (rather than the whole query up front) is what keeps
// a wildcard from shielding whitespace from the floor — `'%   %'` splits to `['', '   ', '']`,
// each of which trims to empty, so it correctly measures as 0 rather than the 3 raw characters
// between the `%`s.
function significantLength(query: string): number {
  const runs = query.split(/[%_]+/).map((run) => run.trim().length)
  return Math.max(...runs)
}

export function isValidSearchQuery(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.length <= MAX_QUERY_LENGTH && significantLength(trimmed) >= MIN_SIGNIFICANT_QUERY_LENGTH
}

function buildSearchBody(query: string): string {
  return new URLSearchParams({ form: 'find_user', user_fullname: query, go: 'Go' }).toString()
}

// http.ts's postFlightlogText already tells a genuine session gate (302 to the origin root)
// apart from any other redirect and retries/throws for that case before this function ever
// sees it — so a `redirect` outcome here always carries something this app might actually
// understand: an a=28 profile link, or markup drift neither of us has seen before. Anything
// that isn't recognisably the former is thrown, not swallowed into an empty result set — the
// same policy parsePilotSearch itself uses for HTML it can't recognise.
function readSingleMatchUserId(location: string | null): number {
  if (location === null) {
    throw new Error('flightlog.org redirected the pilot search with no Location header')
  }

  const resolved = new URL(location, FLIGHTLOG_ORIGIN)
  const userId = Number(resolved.searchParams.get('user_id'))
  const isProfileRedirect = resolved.pathname === '/fl.html' && resolved.searchParams.get('a') === String(PROFILE_ACTION) && isValidPilotId(userId)

  if (!isProfileRedirect) {
    throw new Error(`flightlog.org redirected the pilot search to an unrecognized location: ${location}`)
  }
  return userId
}

export async function searchPilots(query: string): Promise<PilotSearchOutcome> {
  // Trimmed once, here, and that single value feeds both the guard and the request body below —
  // isValidSearchQuery trims internally too (so callers checking it directly against a raw query
  // still get the right answer), but that trim happening a second time is a no-op. What must not
  // happen is the guard measuring one string while the network call sends another: a stray
  // leading/trailing space that the guard trims away but the body doesn't would validate as
  // `abc` and go out as `++abc++`.
  const trimmedQuery = query.trim()

  // The hard gate against a full-table-scan query — see MIN_SIGNIFICANT_QUERY_LENGTH's doc
  // comment. The page also checks isValidSearchQuery before calling this at all (so it can
  // show a distinct "type more" message instead of a silent empty state), but the check that
  // actually matters is this one: it is the last thing standing between a caller and the
  // network call below.
  if (!isValidSearchQuery(trimmedQuery)) return { kind: 'results', results: [] }

  const response = await postFlightlogText(PILOT_SEARCH_PATH, buildSearchBody(trimmedQuery), {
    referer: PILOT_SEARCH_PAGE_REFERER,
  })

  if (response.kind === 'redirect') {
    return { kind: 'single-match', userId: readSingleMatchUserId(response.location) }
  }
  return { kind: 'results', results: parsePilotSearch(response.text) }
}
