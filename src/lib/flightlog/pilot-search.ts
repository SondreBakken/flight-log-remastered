import 'server-only'
import { postFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parsePilotSearch } from './parse-pilot-search'
import type { PilotSearchResult } from './types'

const ENGLISH = 1
const PILOT_SEARCH_ACTION = 114
const PILOT_SEARCH_PATH = `/fl.html?l=${ENGLISH}&a=${PILOT_SEARCH_ACTION}`
// The real page a browser has open when it submits this form — a=114 itself, confirmed live
// (see docs/flightlog-api.md) — not some other page in this app's own tree, mirroring
// clubs.ts's COUNTRY_INDEX_PAGE referer choice for the same reason: this is what flightlog.org
// actually sees a real client send.
const PILOT_SEARCH_PAGE_REFERER = `${FLIGHTLOG_ORIGIN}${PILOT_SEARCH_PATH}`

// Every query is implicitly substring-wrapped server side, and `%`/`_` are live SQL LIKE
// wildcards layered on top (confirmed live, docs/flightlog-api.md) — so an empty query, a bare
// `%`, `%%`, or `_` all ask for the entire pilot table, and there is no server-side cap or
// pagination to fall back on: a 3-real-character query (`nde`) already returns 300+ pilots in
// one 48KB response. Nothing short of this floor can promise a *small* result set — even 3
// characters doesn't — so its job is narrower: refuse the specific patterns above (all of which
// strip to 0 significant characters) and refuse a single bare character (which, for any common
// letter, is close enough to "the whole table" to carry the same risk), while leaving a query
// that already demonstrates real narrowing — `nde`, or the wildcard-narrowed `H_nden` from the
// docs (5 significant characters) — untouched. 3 is picked because it's the shortest fragment
// already verified live to behave like a real, if unbounded, substring search rather than a
// full-table dump.
export const MIN_SIGNIFICANT_QUERY_LENGTH = 3

function significantLength(query: string): number {
  return query.trim().replace(/[%_]/g, '').length
}

export function isValidSearchQuery(query: string): boolean {
  return significantLength(query) >= MIN_SIGNIFICANT_QUERY_LENGTH
}

function buildSearchBody(query: string): string {
  return new URLSearchParams({ form: 'find_user', user_fullname: query, go: 'Go' }).toString()
}

export async function searchPilots(query: string): Promise<PilotSearchResult[]> {
  // The hard gate against a full-table-scan query — see MIN_SIGNIFICANT_QUERY_LENGTH's doc
  // comment. The page also checks isValidSearchQuery before calling this at all (so it can
  // show a distinct "type more" message instead of a silent empty state), but the check that
  // actually matters is this one: it is the last thing standing between a caller and the
  // network call below.
  if (!isValidSearchQuery(query)) return []

  const html = await postFlightlogText(PILOT_SEARCH_PATH, buildSearchBody(query), {
    referer: PILOT_SEARCH_PAGE_REFERER,
  })
  return parsePilotSearch(html)
}
