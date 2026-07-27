import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { PilotSearchResult } from './types'

const PROFILE_LINK_ACTION = 28
// The a=114 response never wraps its results in a table (see docs/flightlog-api.md) — country
// group headers and pilot links are flat text/anchor siblings inside the same div that holds
// the search `<form>` itself. That form is unique to a=114 (GET form, POST results, POST
// zero-match all render the identical `<form ... action='/fl.html?l=1&a=114'>`) and never
// appears on any other page type, so it is the anchor: a stricter, page-specific guard than
// the div wrapping it, which is generic chrome shared with a=25/clubs (see parse-clubs.ts's
// own note on why its div-based anchor used to let a pilot page parse as "zero clubs" instead
// of throwing — same bug class, avoided here by anchoring on the form instead of the div).
// Anchored with `(?:\?|&)...(?:&|$)` rather than a bare `includes` check specifically so this
// matches `a=114` only — never a page whose form happens to carry some other action code, e.g.
// the real login form (`a=37`) or the homepage's — a page-specific anchor is only as safe as
// the specificity of the match itself.
const SEARCH_FORM_ACTION_PATTERN = /(?:\?|&)a=114(?:&|$)/
// Same anchoring reasoning as the form action above: `includes('a=28')` would also match
// `a=280` or even `data=28`, silently treating an unrelated action code as a valid profile
// link instead of failing the row.
const PROFILE_LINK_ACTION_PATTERN = new RegExp(`(?:\\?|&)a=${PROFILE_LINK_ACTION}(?:&|$)`)
// Every page on the site carries an `hp-nav` honeypot link (see docs/flightlog-api.md) — never
// observed inside a=114's own results in practice, but that is incidental to where the trap
// happens to render today, not a defence (same reasoning as parse-clubs.ts, which this
// selector is copied from verbatim).
const HONEYPOT_SELECTOR = '.hp-nav, [data-trap], [rel="nofollow"]'
// The banner flightlog.org renders above (not inside) the results div on a genuine zero-match
// response — see docs/flightlog-api.md. Its presence is what tells a real "nobody matched" apart
// from markup drift that happens to also yield zero candidates (a renamed `user_id=` param, an
// extra layer of nesting the direct-children walk below can't see through, …): only look for the
// literal message text, not any particular wrapper markup around it, since nothing about the
// banner's own shape has been cross-checked against drift the way the results shape has.
const ZERO_MATCH_BANNER_PATTERN = /No match found/
// Real country headers are bare text nodes reading `<Name>:` (see docs/flightlog-api.md) — every
// other non-whitespace text node in this container is either the form's own label text (which
// pretext trim() already handles, see collectCandidates) or, if drift has introduced one,
// something we don't understand and would rather fail on than silently misfile as a country
// (e.g. a result-count banner like "Showing 1 result").
const COUNTRY_HEADER_PATTERN = /^[\p{L}\p{M} .,'()-]+:$/u

function isSearchForm(action: string | undefined): boolean {
  return SEARCH_FORM_ACTION_PATTERN.test(action ?? '')
}

function isProfileLink(href: string): boolean {
  return PROFILE_LINK_ACTION_PATTERN.test(href)
}

function findResultsContainer($: ReturnType<typeof cheerio.load>): Nodes {
  const form = $('form')
    .filter((_, el) => isSearchForm($(el).attr('action')))
    .first()
  return form.parent()
}

function readUserId(href: string | undefined): number | null {
  const match = href?.match(/user_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

type Candidate = { anchor: Nodes; country: string | null }

// Candidates are identified on "any non-honeypot anchor", not on `user_id=` — a drifted action
// code (28 -> something else) *or* a drifted id param (`user_id=` -> something else) still
// counts every real result as a candidate that then fails strict extraction below (readUserId
// returns null, so does toPilotSearchResult), tripping the floor instead of silently vanishing
// the way a `user_id=`-gated candidacy check would let either drift do.
// Country tracking walks every direct child of the container in document order: a text node
// matching COUNTRY_HEADER_PATTERN is a "<Country>:" header (trim() already discards both
// ordinary whitespace and the `&nbsp;`-only indent text nodes that precede every pilot link —
// U+00A0 is "White Space" per the ECMAScript spec, so it disappears the same way a plain space
// does); a real, non-honeypot `<a>` is a candidate row under whatever header was most recently
// seen. Everything else (the `<form>` itself, `<br>`) is neither and is simply skipped — but a
// non-empty text node that ISN'T a country header (a stray result-count banner, say) throws
// rather than silently overwriting currentCountry with garbage.
function collectCandidates($: ReturnType<typeof cheerio.load>, container: Nodes): Candidate[] {
  let currentCountry: string | null = null
  const candidates: Candidate[] = []

  container.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = $(node).text().trim()
      if (text === '') return
      if (!COUNTRY_HEADER_PATTERN.test(text)) {
        throw new Error(`Pilot search markup not recognised: unexpected text "${text}" where a country header was expected`)
      }
      currentCountry = text.replace(/:\s*$/, '')
      return
    }
    if (node.type === 'tag' && node.name === 'a') {
      const anchor = $(node)
      if (anchor.is(HONEYPOT_SELECTOR)) return
      candidates.push({ anchor, country: currentCountry })
    }
  })

  return candidates
}

function toPilotSearchResult(candidate: Candidate): PilotSearchResult | null {
  const href = candidate.anchor.attr('href')
  if (!href || !isProfileLink(href)) return null

  const userId = readUserId(href)
  const name = textOrNull(candidate.anchor.text())
  const country = candidate.country
  if (userId === null || name === null || country === null) return null

  return { userId, name, country }
}

// Same pilot can legitimately appear as a candidate twice (e.g. under two different anchors
// pointing at the same profile within one row's markup); deduping by userId here — after the
// strict floor check below, not before — keeps the floor honest about candidate count while
// still guaranteeing the final list can't hand React two rows with the same key.
function dedupeByUserId(results: PilotSearchResult[]): PilotSearchResult[] {
  const seen = new Set<number>()
  return results.filter((result) => {
    if (seen.has(result.userId)) return false
    seen.add(result.userId)
    return true
  })
}

export function parsePilotSearch(html: string): PilotSearchResult[] {
  const $ = cheerio.load(html)
  const container = findResultsContainer($)
  if (container.length === 0) {
    throw new Error('Pilot search markup not recognised: no search form found')
  }

  const candidates = collectCandidates($, container)

  // Zero candidates means either a genuine zero-match search or markup drift so severe that no
  // row was even recognised as a candidate (a renamed `user_id=`, an extra layer of nesting the
  // direct-children walk above can't see through, the form itself resolving to the wrong
  // container). Those two are indistinguishable from candidate count alone — candidates.length
  // is 0 either way — so only the zero-match banner (present on a genuine zero-match response,
  // absent whenever real results exist) can tell them apart.
  if (candidates.length === 0) {
    if (!ZERO_MATCH_BANNER_PATTERN.test($('body').text())) {
      throw new Error('Pilot search markup not recognised: zero candidate rows without the "No match found" banner')
    }
    return []
  }

  const results = candidates.map(toPilotSearchResult).filter((result): result is PilotSearchResult => result !== null)

  // A results container with rows we failed to parse is not the same as a genuine zero-match
  // response, same distinction parse-clubs.ts draws between Bouvet Island and a partially-broken
  // row.
  if (results.length !== candidates.length) {
    throw new Error(
      `Pilot search partially unparsed: ${results.length}/${candidates.length} rows recognised`,
    )
  }

  return dedupeByUserId(results)
}
