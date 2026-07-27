import * as cheerio from 'cheerio'
import type { PilotSearchResult } from './types'

type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

const PROFILE_LINK_ACTION = 28
// The a=114 response never wraps its results in a table (see docs/flightlog-api.md) — country
// group headers and pilot links are flat text/anchor siblings inside the same div that holds
// the search `<form>` itself. That form is unique to a=114 (GET form, POST results, POST
// zero-match all render the identical `<form ... action='/fl.html?l=1&a=114'>`) and never
// appears on any other page type, so it is the anchor: a stricter, page-specific guard than
// the div wrapping it, which is generic chrome shared with a=25/clubs (see parse-clubs.ts's
// own note on why its div-based anchor used to let a pilot page parse as "zero clubs" instead
// of throwing — same bug class, avoided here by anchoring on the form instead of the div).
const SEARCH_FORM_ACTION_PATTERN = /(?:\?|&)a=114(?:&|$)/
// Every page on the site carries an `hp-nav` honeypot link (see docs/flightlog-api.md) — never
// observed inside a=114's own results in practice, but that is incidental to where the trap
// happens to render today, not a defence (same reasoning as parse-clubs.ts, which this
// selector is copied from verbatim).
const HONEYPOT_SELECTOR = '.hp-nav, [data-trap], [rel="nofollow"]'

function isSearchForm(action: string | undefined): boolean {
  return SEARCH_FORM_ACTION_PATTERN.test(action ?? '')
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

// Candidates are identified independently of PROFILE_LINK_ACTION, on `user_id=` alone — a
// drifted action code (28 -> something else) still counts every real result as a candidate
// that then fails strict extraction below, tripping the floor instead of silently vanishing.
// Country tracking walks every direct child of the container in document order: a plain
// non-empty text node is a "<Country>:" header (there is nothing else free-text in this
// container besides those headers and the whitespace `<form>` leaves around itself, and
// trim() already discards both ordinary whitespace and the `&nbsp;`-only indent text nodes
// that precede every pilot link — U+00A0 is "White Space" per the ECMAScript spec, so it
// disappears the same way a plain space does); a real, non-honeypot `<a>` carrying `user_id=`
// is a candidate row under whatever header was most recently seen. Everything else (the
// `<form>` itself, `<br>`) is neither and is simply skipped.
function collectCandidates($: ReturnType<typeof cheerio.load>, container: Nodes): Candidate[] {
  let currentCountry: string | null = null
  const candidates: Candidate[] = []

  container.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = $(node).text().trim()
      if (text !== '') currentCountry = text.replace(/:\s*$/, '')
      return
    }
    if (node.type === 'tag' && node.name === 'a') {
      const anchor = $(node)
      if (anchor.is(HONEYPOT_SELECTOR)) return
      if (!anchor.attr('href')?.includes('user_id=')) return
      candidates.push({ anchor, country: currentCountry })
    }
  })

  return candidates
}

function toPilotSearchResult(candidate: Candidate): PilotSearchResult | null {
  const href = candidate.anchor.attr('href')
  if (!href?.includes(`a=${PROFILE_LINK_ACTION}`)) return null

  const userId = readUserId(href)
  const name = textOrNull(candidate.anchor.text())
  const country = candidate.country
  if (userId === null || name === null || country === null) return null

  return { userId, name, country }
}

export function parsePilotSearch(html: string): PilotSearchResult[] {
  const $ = cheerio.load(html)
  const container = findResultsContainer($)
  if (container.length === 0) {
    throw new Error('Pilot search markup not recognised: no search form found')
  }

  const candidates = collectCandidates($, container)
  const results = candidates.map(toPilotSearchResult).filter((result): result is PilotSearchResult => result !== null)

  // A results container with rows we failed to parse is not the same as a genuine zero-match
  // response (both a fresh GET form and a real zero-match POST have candidates.length === 0),
  // same distinction parse-clubs.ts draws between Bouvet Island and a partially-broken row.
  if (results.length !== candidates.length) {
    throw new Error(
      `Pilot search partially unparsed: ${results.length}/${candidates.length} rows recognised`,
    )
  }

  return results
}
