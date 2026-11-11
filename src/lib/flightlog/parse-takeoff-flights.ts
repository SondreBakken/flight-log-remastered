import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { TakeoffFlight } from './types'

// The flights results table, shared by a=42 and a=47 (fixture-confirmed for both: see
// fixtures/a47-country-160.html and docs/flightlog-api.md).
export const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="2"][bgcolor="#22aa00"]'
const FLIGHT_ROW_CELL_COUNT = 6
const DATE_ROW_COLSPAN = '6'
const PILOT_LINK_ACTION = 28
const CLUB_LINK_ACTION = 43
const TRIP_LINK_ACTION = 34

// The page's own `<h3>Flights - <name></h3>` heading — empty for a nonexistent start_id,
// populated for a real takeoff, the same identity role parseTakeoffDetail's breadcrumb span
// plays for a=22. See docs/flightlog-api.md's "a=42 (flights at a takeoff)" section.
const FLIGHTS_HEADING_SELECTOR = 'h3'
const FLIGHTS_HEADING_PREFIX = /^Flights\s*-\s*/

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

// Exported so parse-takeoff-detail.ts's own trip-id extraction reuses this instead of a second,
// hand-copied regex.
export function readIdFromHref(href: string | undefined, param: string): number | null {
  const match = href?.match(new RegExp(`${param}=(\\d+)`))
  return match ? Number(match[1]) : null
}

// A date-group header: `<tr><td colspan='6'><b>2026-07-17</b></td></tr>`, one `<td>`, not six —
// checked structurally (colspan), not by cell count alone, so a malformed one-cell row of some
// other kind can't silently become "today's date".
function readDateLabel(row: Nodes): string | null {
  const cells = row.children('td')
  if (cells.length !== 1 || cells.eq(0).attr('colspan') !== DATE_ROW_COLSPAN) return null
  return textOrNull(cells.eq(0).text())
}

// The pilot/club/country/glider cell packs all four into one `<td>` with `<br>` as the only
// separator between the link trio and the glider text. No `<br>` at all means there is no
// glider text to isolate, so this returns null rather than misreading the whole cell's text as
// a glider.
function readGlider(cell: Nodes): string | null {
  const fragments = (cell.html() ?? '').split(/<br\s*\/?>/i)
  if (fragments.length < 2) return null
  return textOrNull(cheerio.load(fragments[fragments.length - 1]!).text())
}

function toFlight(cells: Nodes, date: string | null): TakeoffFlight | null {
  if (cells.length !== FLIGHT_ROW_CELL_COUNT) return null

  const tripLink = cells.eq(1).find(`a[href*="a=${TRIP_LINK_ACTION}"]`).first()
  const tripId = readIdFromHref(tripLink.attr('href'), 'trip_id')

  const profileCell = cells.eq(2)
  const pilotLink = profileCell.find(`a[href*="a=${PILOT_LINK_ACTION}"]`).first()
  const userId = readIdFromHref(pilotLink.attr('href'), 'user_id')
  const pilotName = textOrNull(pilotLink.text())

  if (tripId === null || userId === null || pilotName === null) return null

  return {
    tripId,
    userId,
    pilotName,
    club: textOrNull(profileCell.find(`a[href*="a=${CLUB_LINK_ACTION}"]`).first().text()),
    glider: readGlider(profileCell),
    duration: textOrNull(cells.eq(3).text()),
    distanceKm: readNumber(cells.eq(4).text()),
    note: textOrNull(cells.eq(5).text()),
    date,
    timeOfDay: textOrNull(cells.eq(0).text()),
  }
}

// Walks the results table's rows in document order, tracking the most recent date-group
// header, and collects every 6-cell row alongside the date it falls under — pure structural
// grouping; field extraction is toFlight's job, one level up.
function collectFlightRowCandidates(rows: Nodes[]): { cells: Nodes; date: string | null }[] {
  let currentDate: string | null = null
  const candidates: { cells: Nodes; date: string | null }[] = []
  for (const row of rows) {
    const dateLabel = readDateLabel(row)
    if (dateLabel !== null) {
      currentDate = dateLabel
      continue
    }
    const cells = row.children('td')
    if (cells.length === FLIGHT_ROW_CELL_COUNT) candidates.push({ cells, date: currentDate })
  }
  return candidates
}

// The shared a=42/a=47 row walk: every 6-cell row under its date-group header, strictly
// extracted. `label` names the page in the error messages.
export function parseFlightRows($: ReturnType<typeof cheerio.load>, table: Nodes, label: string): TakeoffFlight[] {
  const rows = table.find('tr').toArray().map((row) => $(row))
  const candidates = collectFlightRowCandidates(rows)
  const flights = candidates.map(({ cells, date }) => toFlight(cells, date)).filter((flight): flight is TakeoffFlight => flight !== null)

  // Same floor check every other parser in this file family uses: a row that looked like a
  // flight but failed strict extraction is a defect, not a smaller flight count.
  if (flights.length !== candidates.length) {
    throw new Error(`Flights partially unparsed for ${label}: ${flights.length}/${candidates.length} rows recognised`)
  }
  return flights
}

// Returns null when this response's own `<h3>` heading carries no takeoff name — the identity
// gate for the identical empty results table a genuine zero-flights-this-year takeoff AND a
// nonexistent start_id both render (see docs/flightlog-api.md). A caller with independent
// confirmation the takeoff exists (getTakeoffDetail returning non-null) treats a null return
// here as a genuine inconsistency between the two responses, not a 404 — see
// takeoff-flights.ts and page.tsx's own doc comments.
export function parseTakeoffFlights(html: string, takeoffId: number): TakeoffFlight[] | null {
  const $ = cheerio.load(html)
  const table = $(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    throw new Error(`Takeoff flights markup not recognised for takeoff ${takeoffId}: no results table found`)
  }

  const heading = $(FLIGHTS_HEADING_SELECTOR).first().text()
  if (!FLIGHTS_HEADING_PREFIX.test(heading)) {
    throw new Error(`Takeoff flights markup not recognised for takeoff ${takeoffId}: no "Flights - " heading found`)
  }
  const name = textOrNull(heading.replace(FLIGHTS_HEADING_PREFIX, ''))

  const flights = parseFlightRows($, table, `takeoff ${takeoffId}`)

  return name === null ? null : flights
}
