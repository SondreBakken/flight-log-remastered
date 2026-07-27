import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { Club } from './types'

const CLUB_LINK_ACTION = 26
// Every page on the site carries an `hp-nav` honeypot link — regenerated per request,
// off-screen, `rel='nofollow'`, `data-trap='1'` (see docs/flightlog-api.md). Its real href
// never contains `club_id=`, so on the live site it never reaches `findClubAnchor` at all —
// but that is incidental, not a defence: a page that placed a trap *inside* the results
// table with a `club_id=` href would be indistinguishable from a real row without this
// explicit exclusion. Match on the markers, not on where the trap happens to live.
const HONEYPOT_SELECTOR = '.hp-nav, [data-trap], [rel="nofollow"]'
// Anchors the results table itself (cellspacing/cellpadding/bgcolor are literal HTML
// attributes cheerio parses off the tag, not a style string needing substring matching —
// unlike the div wrapper this replaces, there is no whitespace-in-value edge case to
// tolerate or decide about). Confirmed unique to this table across every fixture on hand
// (clubs, empty-clubs, countries, two pilot pages) — the div wrapper this replaces
// (`div[style*="padding:0px 10px"]`) is generic page chrome present on pilot pages too,
// so feeding a pilot page to this parser used to return `[]` instead of throwing.
const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="black"]'

function readClubId(href: string | undefined): number | null {
  const match = href?.match(/club_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Flight count is a plain integer cell, not a distance measurement — no comma-as-decimal
// handling belongs here (that logic exists in parse-flights.ts because distances actually
// use it; borrowing it here silently turned "1,234" into 1.234). Reject anything that is
// not a bare run of digits rather than guessing what a separator meant.
function readInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function findClubAnchor(row: Nodes): Nodes {
  return row.find('a[href*="club_id="]').not(HONEYPOT_SELECTOR).first()
}

// The flight-count cell has no matching open tag for its trailing </a> — real malformed
// markup on this page, same family of defect parse-flights.ts already works around.
function toClub(row: Nodes): Club | null {
  const anchor = findClubAnchor(row)
  if (anchor.length === 0) return null

  const href = anchor.attr('href')
  if (!href?.includes(`a=${CLUB_LINK_ACTION}`)) return null

  const clubId = readClubId(href)
  const name = textOrNull(anchor.text())
  const flightCount = readInteger(row.children('td').eq(1).text())
  if (clubId === null || name === null || flightCount === null) return null

  return { clubId, name, flightCount }
}

function dedupeByClubId(clubs: Club[]): Club[] {
  const seen = new Set<number>()
  return clubs.filter((club) => {
    if (seen.has(club.clubId)) return false
    seen.add(club.clubId)
    return true
  })
}

export function parseClubs(html: string, countryId: number): Club[] {
  const $ = cheerio.load(html)
  const resultsTable = $(RESULTS_TABLE_SELECTOR).first()
  if (resultsTable.length === 0) {
    throw new Error(`Club list markup not recognised for country ${countryId}`)
  }

  // "Candidate" rows are identified independently of CLUB_LINK_ACTION, on `club_id=`
  // alone — so a drifted action code (e.g. 26 -> 27) still counts every real row as a
  // candidate, toClub then fails to extract it, and the floor below catches the mismatch
  // instead of silently returning an empty list.
  const candidateRows = resultsTable
    .find('tr')
    .toArray()
    .map((row) => $(row))
    .filter((row) => findClubAnchor(row).length > 0)

  const clubs = candidateRows.map(toClub).filter((club): club is Club => club !== null)

  // A results table with rows we failed to parse is not the same as a results table with
  // no rows (Bouvet Island: candidateRows.length === clubs.length === 0, a genuine empty
  // country). Any gap between the two means a row that looked like a club silently didn't
  // become one — a defect, not a smaller country.
  if (clubs.length !== candidateRows.length) {
    throw new Error(
      `Club list partially unparsed for country ${countryId}: ${clubs.length}/${candidateRows.length} rows recognised`,
    )
  }

  return dedupeByClubId(clubs)
}
