import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { ClubDetail } from './types'

// Distinct from parse-clubs.ts's own RESULTS_TABLE_SELECTOR (`bgcolor="black"`, the roster
// table below) — the label/value info block on a club detail page uses a different bgcolor.
// Confirmed across all three sampled clubs (Voss/51, Oslo/33, Øø Eiken/37): unique to this
// block, not reused anywhere else on the page.
const INFO_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="#778899"]'

// The member roster shares parse-clubs.ts's exact RESULTS_TABLE_SELECTOR — same page family,
// same table shape — but this file only needs it to confirm the info table isn't being fed a
// clubs-LIST page by mistake; parse-club-roster.ts owns the roster's own parsing.
const ROSTER_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="black"]'

// "Coordinates" and "Link to more info" are deliberately NOT required — Oslo's real fixture
// has no Coordinates row at all, and a club with no external site has no "Link to more info"
// row (see types.ts's own doc comment on ClubDetail). These five are the ones present on
// every one of the three sampled clubs, including the zero-member one.
const REQUIRED_LABELS = ['Description', 'Members', 'created', 'Updated']

// Same technique as parse-takeoff-detail.ts's readBreadcrumbName: Home -> Pilots/Clubs ->
// <Country> -> <Club name>, confirmed 4 spans deep on every sampled club fixture. Club
// detail's own not-found signal is the 0-byte body (see parseClubDetail below), not a
// shortened breadcrumb the way a=22's is — so unlike that file, a missing breadcrumb name
// here on an otherwise-real page is unrecognised markup, not a not-found result.
const BREADCRUMB_SPAN_SELECTOR = "span[style*='font-style:italic']"
const BREADCRUMB_NAME_INDEX = 3

const PLACEHOLDER_DATE = /^0000-00-00 00:00:00\s*$/

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function dateOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' || PLACEHOLDER_DATE.test(trimmed) ? null : trimmed
}

// Members is a plain integer cell, never a distance — no comma-as-decimal handling belongs
// here, same reasoning as parse-clubs.ts's own readInteger (which this mirrors rather than
// imports, following this codebase's existing convention of small per-file helpers over a
// shared one-liner — see e.g. textOrNull, duplicated the same way in every sibling parser).
function readInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function labelledRows($: ReturnType<typeof cheerio.load>, table: Nodes): Map<string, Nodes> {
  const rows = new Map<string, Nodes>()
  table
    .find('tr')
    .toArray()
    .map((row) => $(row))
    .forEach((row) => {
      const cells = row.children('td')
      if (cells.length !== 2) return
      const label = cells.eq(0).text().trim()
      if (label !== '') rows.set(label, cells.eq(1))
    })
  return rows
}

function readBreadcrumbName($: ReturnType<typeof cheerio.load>): string | null {
  const spans = $(BREADCRUMB_SPAN_SELECTOR)
  if (spans.length <= BREADCRUMB_NAME_INDEX) return null
  return textOrNull($(spans.get(BREADCRUMB_NAME_INDEX)).text())
}

// Description and Coordinates both split multi-line values on `<br>` (flightlog.org's only
// paragraph separator) and reload each fragment on its own so `.text()` drops inline markup
// (a club logo `<img>`, the earth.google.com anchor) while still keeping the line breaks —
// same technique as parse-takeoff-detail.ts's readDescription, needed here because Oslo's
// real Description carries an actual `<br><br>` paragraph break, not just a single line.
function readMultilineText(cell: Nodes): string | null {
  const html = cell.html() ?? ''
  const lines = html
    .split(/<br\s*\/?>/i)
    .map((fragment) => cheerio.load(fragment).text().trim())
    .filter((line) => line !== '')
  return lines.length > 0 ? lines.join('\n') : null
}

// Throws for markup this parser cannot recognise at all (missing info table, or missing one
// of REQUIRED_LABELS); returns `null` only for the one confirmed not-found signal this
// endpoint has — a 0-byte body (see docs/flightlog-api.md: a nonexistent `club_id` returns a
// 200 with an empty body, no page shell at all, distinct from a real club with zero members,
// which still renders the full shell with `Members: 0`). A page.tsx caller reacts to a thrown
// error and to `null` differently (the latter with `notFound()`) — collapsing them would make
// a genuinely broken parser indistinguishable from an ordinary 404, the same reasoning
// parse-takeoff-detail.ts documents for its own two-outcome return.
export function parseClubDetail(html: string, clubId: number): ClubDetail | null {
  if (html.trim() === '') return null

  const $ = cheerio.load(html)
  const infoTable = $(INFO_TABLE_SELECTOR).first()
  if (infoTable.length === 0) {
    throw new Error(`Club detail markup not recognised for club ${clubId}: no info table found`)
  }
  if ($(ROSTER_TABLE_SELECTOR).length === 0) {
    throw new Error(`Club detail markup not recognised for club ${clubId}: no member roster table found`)
  }

  const rows = labelledRows($, infoTable)
  const missingLabels = REQUIRED_LABELS.filter((label) => !rows.has(label))
  if (missingLabels.length > 0) {
    throw new Error(
      `Club detail markup not recognised for club ${clubId}: missing expected field(s) [${missingLabels.join(', ')}]`,
    )
  }

  const name = readBreadcrumbName($)
  if (name === null) {
    throw new Error(`Club detail markup not recognised for club ${clubId}: no breadcrumb club name found`)
  }

  const memberCount = readInteger(rows.get('Members')!.text())
  if (memberCount === null) {
    throw new Error(`Club detail markup not recognised for club ${clubId}: unreadable Members count`)
  }

  const linkCell = rows.get('Link to more info')
  const coordinatesCell = rows.get('Coordinates')

  return {
    clubId,
    name,
    memberCount,
    coordinatesText: coordinatesCell ? readMultilineText(coordinatesCell) : null,
    mapUrl: coordinatesCell ? (coordinatesCell.find('a').first().attr('href') ?? null) : null,
    description: readMultilineText(rows.get('Description')!),
    linkUrl: linkCell ? (linkCell.find('a').first().attr('href') ?? null) : null,
    createdAt: dateOrNull(rows.get('created')!.text()),
    updatedAt: dateOrNull(rows.get('Updated')!.text()),
  }
}
