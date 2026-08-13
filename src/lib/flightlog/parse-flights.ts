import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { Flight, Pilot, TakeoffRef } from './types'

const FLIGHT_ROW_CELL_COUNT = 7
const COUNTRY_LINK_ACTION = 47
const TAKEOFF_LINK_ACTION = 42

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readTripId(href: string | undefined): number | null {
  const match = href?.match(/trip_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function readDate(cellText: string): string | null {
  return cellText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
}

// A row can aggregate several flights from the same day, rendered as "00:10 / 2" — the
// duration read here is that row's GROUP TOTAL, not a per-flight duration (#68; see Flight's
// own doc comment in types.ts).
function readDuration(cellText: string): string | null {
  return cellText.match(/\d{1,2}:\d{2}/)?.[0] ?? null
}

function readFlightCount(cellText: string): number {
  return readNumber(cellText.match(/\/\s*(\d+)/)?.[1] ?? '') ?? 1
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// The date cell packs date, country link and takeoff link together; the links are told
// apart by which action code they point at. Shared by readLinkByAction (display text) and
// readLinkHrefByAction (the href itself, for #76's takeoffRef) so both read the same node
// rather than re-running the selector twice per cell.
function findLinkByAction(cell: Nodes, action: number): Nodes | null {
  const link = cell.find(`a[href*="a=${action}"]`).first()
  return link.length === 0 ? null : link
}

function readLinkByAction(cell: Nodes, action: number): string | null {
  return textOrNull(findLinkByAction(cell, action)?.text() ?? '')
}

function readLinkHrefByAction(cell: Nodes, action: number): string | undefined {
  return findLinkByAction(cell, action)?.attr('href')
}

// #76's approved join key: the takeoff link's own `country_id`/`start_id` query params
// (`?l=1&a=42&country_id=160&start_id=15`), not its display text — verified 5/5 sampled across
// 4 countries to equal the takeoffs dataset's own countryId/takeoffId. A link-less cell (no
// `a=42` at all) or a malformed href (either param missing) yields null rather than a partial
// ref — a flight with a null ref still keeps its `takeoff` display text (read independently,
// above) and is a visible unmatched site in the join, never a dropped one (see
// browse-flown-sites-map/join-flown-sites.ts).
function readTakeoffRef(href: string | undefined): TakeoffRef | null {
  const countryId = href?.match(/country_id=(\d+)/)?.[1]
  const takeoffId = href?.match(/start_id=(\d+)/)?.[1]
  if (countryId === undefined || takeoffId === undefined) return null
  return { countryId: Number(countryId), takeoffId: Number(takeoffId) }
}

// Shared with parse-pilot-email.ts (and get-pilot-email.ts's own cell-presence check) — all
// three read the exact same profile cell, and duplicating the selector string risked one
// changing without the others, silently degrading lookups.
export const PROFILE_CELL_SELECTOR = 'td[width="s180"]'

// A page-shape check for a=28's own not-found signal, live-verified (curl, 2026-08 — see
// docs/testing.md's fixture-regeneration recipe) at pilot ids 1, 2, 30000, 50000, 99999 and
// 999999999, all confirmed unallocated (adjacent ids like 12678/12679 resolve to real, distinct
// pilots): the page renders WITHOUT this cell at all, not with the cell present-but-empty this
// file's own is-fallback-pilot.ts doc comment describes. Getting this wrong matters: a caller
// that throws on every missing-cell page (e.g. to catch a WAF challenge or markup drift) would
// throw on every ordinary "no such pilot" lookup too, unless it can tell this genuine not-found
// shape apart from a truly unrecognised one first.
export function hasProfileCell(html: string): boolean {
  return cheerio.load(html)(PROFILE_CELL_SELECTOR).length > 0
}

const PILOT_NOT_FOUND_TEXT = 'not found'

// The actual not-found signal for a=28 (see hasProfileCell's own doc comment): a page-shell
// `<div>` whose only content is the literal text "not found" — confirmed byte-identical (aside
// from the requested user_id and a per-request honeypot resource link) across every unallocated
// id sampled live. Not scoped to a specific selector beyond `<div>` since the marker carries no
// class or id of its own; a genuinely unrecognised page (WAF challenge, empty body, markup
// drift) has no reason to also happen to contain this exact text.
export function isPilotNotFoundPage(html: string): boolean {
  const $ = cheerio.load(html)
  return $('div')
    .toArray()
    .some((el) => $(el).text().trim() === PILOT_NOT_FOUND_TEXT)
}

export function parsePilot(html: string, userId: number): Pilot {
  const $ = cheerio.load(html)
  const profileCell = $(PROFILE_CELL_SELECTOR).first()
  const lines = profileCell
    .html()
    ?.split(/<br\s*\/?>/i)
    .map((line) => cheerio.load(line).text().trim())
    .filter(Boolean)

  return {
    userId,
    name: lines?.[0] ?? `Pilot ${userId}`,
    country: lines?.[1] ?? null,
    club: textOrNull(profileCell.find('a[href*="a=26"]').first().text()),
  }
}

export function parseFlights(html: string, userId: number): Flight[] {
  const $ = cheerio.load(html)

  return $('tr')
    .toArray()
    .map((row) => toFlight($(row).children('td'), userId))
    .filter((flight): flight is Flight => flight !== null)
}

function toFlight(cells: Nodes, userId: number): Flight | null {
  if (cells.length !== FLIGHT_ROW_CELL_COUNT) return null

  const tripId = readTripId(cells.eq(0).find('a').first().attr('href'))
  const dateCell = cells.eq(1)
  const date = readDate(dateCell.text())
  if (tripId === null || date === null) return null

  return {
    tripId,
    userId,
    date,
    country: readLinkByAction(dateCell, COUNTRY_LINK_ACTION),
    takeoff: readLinkByAction(dateCell, TAKEOFF_LINK_ACTION),
    takeoffRef: readTakeoffRef(readLinkHrefByAction(dateCell, TAKEOFF_LINK_ACTION)),
    glider: textOrNull(cells.eq(2).text()),
    duration: readDuration(cells.eq(3).text()),
    flightCount: readFlightCount(cells.eq(3).text()),
    distanceKm: readNumber(cells.eq(4).text().trim()),
    openDistanceKm: readNumber(cells.eq(5).text().trim()),
    note: textOrNull(cells.eq(6).text()),
  }
}
