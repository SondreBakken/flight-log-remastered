import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { ClubMember } from './types'

const PROFILE_LINK_ACTION = 28
// Same reasoning as parse-clubs.ts's own copy: the honeypot's real href never carries
// `user_id=` today, but that is incidental to where the trap happens to sit, not a defence —
// exclude it structurally, regardless of href content or document position.
const HONEYPOT_SELECTOR = '.hp-nav, [data-trap], [rel="nofollow"]'
// Same three-attribute anchor parse-clubs.ts uses for the clubs-list results table — on a
// club DETAIL page this is the member roster specifically (the info block above it uses a
// different bgcolor, see parse-club-detail.ts's INFO_TABLE_SELECTOR), confirmed unique on
// every sampled fixture.
const ROSTER_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="black"]'

function readUserId(href: string | undefined): number | null {
  const match = href?.match(/user_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Scoped to `row.find(...)`, never the whole document — a real a=26 page also carries a
// handful of unrelated `user_id=`-bearing icon anchors elsewhere on the page (a "pilot
// details" `<img>` link with `&xc=xc`, observed 5 times on Voss's own fixture, none of them
// inside this table). Searching the whole page for `a[href*="user_id="]` would have picked
// those up as phantom roster rows; scoping to rows already inside ROSTER_TABLE_SELECTOR is
// what excludes them, the same way parse-clubs.ts's findClubAnchor is scoped to its own
// results table rather than the document.
function findMemberAnchor(row: Nodes): Nodes {
  return row.find('a[href*="user_id="]').not(HONEYPOT_SELECTOR).first()
}

function toMember(row: Nodes): ClubMember | null {
  const anchor = findMemberAnchor(row)
  if (anchor.length === 0) return null

  const href = anchor.attr('href')
  if (!href?.includes(`a=${PROFILE_LINK_ACTION}`)) return null

  const userId = readUserId(href)
  const name = textOrNull(anchor.text())
  if (userId === null || name === null) return null

  return { userId, name }
}

// A given name can legitimately belong to two different members (see docs/flightlog-api.md's
// "THE JOIN" — Voss alone has 7 name collisions, 6 real pairs plus one 5-way group of blank
// names from a markup artifact elsewhere on the page, never reaching this function because
// they live outside ROSTER_TABLE_SELECTOR) — this dedupes by `userId` only, exactly like
// parse-clubs.ts's dedupeByClubId, never by name: two roster rows sharing a name are two
// real, distinct members, not a duplicate to collapse.
function dedupeByUserId(members: ClubMember[]): ClubMember[] {
  const seen = new Set<number>()
  return members.filter((member) => {
    if (seen.has(member.userId)) return false
    seen.add(member.userId)
    return true
  })
}

// Called only after parseClubDetail has already confirmed this is a real, non-empty-body
// club page (see that file's own doc comment on the 0-byte not-found signal) — this parser
// does not re-check for that itself, so an empty string here is markup drift, not "no such
// club", and throws rather than silently returning `[]`.
export function parseClubRoster(html: string, clubId: number): ClubMember[] {
  const $ = cheerio.load(html)
  const rosterTable = $(ROSTER_TABLE_SELECTOR).first()
  if (rosterTable.length === 0) {
    throw new Error(`Club roster markup not recognised for club ${clubId}: no roster table found`)
  }

  // Candidates are identified on "any row with a user_id= anchor inside the roster table",
  // independent of PROFILE_LINK_ACTION — a drifted action code (28 -> something else) still
  // counts every real row as a candidate, toMember then fails to extract it, and the floor
  // check below catches the mismatch instead of silently returning a smaller roster.
  const candidateRows = rosterTable
    .find('tr')
    .toArray()
    .map((row) => $(row))
    .filter((row) => findMemberAnchor(row).length > 0)

  const members = candidateRows.map(toMember).filter((member): member is ClubMember => member !== null)

  // Same distinction parse-clubs.ts draws between a country with genuinely zero clubs and a
  // partially-broken row: a roster table with rows we failed to parse is not the same as a
  // roster table with no rows (a real club with zero members: candidateRows.length ===
  // members.length === 0). Any gap between the two means a row that looked like a member
  // silently didn't become one.
  if (members.length !== candidateRows.length) {
    throw new Error(
      `Club roster partially unparsed for club ${clubId}: ${members.length}/${candidateRows.length} rows recognised`,
    )
  }

  return dedupeByUserId(members)
}
