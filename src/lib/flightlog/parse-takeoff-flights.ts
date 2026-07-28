import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { TakeoffFlight } from './types'

// a=42's own flights table. This exact triple (cellspacing/cellpadding/bgcolor) is very
// likely shared with a=47's country-wide flight list (docs/flightlog-api.md's own sample of
// that endpoint shows the same row shape) — not confirmed against a live a=47 fixture, but it
// does not need to be: this app never fetches a=47, so the only response this parser is ever
// fed in production is a=42's own.
const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="2"][bgcolor="#22aa00"]'
const FLIGHT_ROW_CELL_COUNT = 6
const DATE_ROW_COLSPAN = '6'
const PILOT_LINK_ACTION = 28
const CLUB_LINK_ACTION = 43
const TRIP_LINK_ACTION = 34

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readIdFromHref(href: string | undefined, param: string): number | null {
  const match = href?.match(new RegExp(`${param}=(\\d+)`))
  return match ? Number(match[1]) : null
}

// A date-group header: `<tr><td colspan='6'><b>2026-07-17</b></td></tr>`, one `<td>`, not six
// — never confused with a flight row by cell count alone, but checked structurally (colspan)
// rather than assumed from count alone, since a malformed one-cell row of some other kind
// should not silently become "today's date".
function readDateLabel(row: Nodes): string | null {
  const cells = row.children('td')
  if (cells.length !== 1 || cells.eq(0).attr('colspan') !== DATE_ROW_COLSPAN) return null
  return textOrNull(cells.eq(0).text())
}

// The pilot/club/country/glider cell packs all four into one `<td>` with `<br>` as the only
// separator between the link trio and the glider text — same shape parse-flights.ts's own
// profile-cell handling and parse-takeoff-detail.ts's description both already split on. No
// `<br>` at all (not observed in any sampled row, but not structurally guaranteed either) means
// there is no glider text to isolate, so this returns null rather than misreading the whole
// cell's text — including the pilot/club/country names — as a glider.
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

// Current year only, matching upstream's own default: a bare `a=42&country_id=N&start_id=M`
// request (no `year=` param) already returns the current year, exactly as this app wants (see
// #11's own scope note) — no `year=` is ever added here. `offset=`, the pagination link this
// response always renders regardless of row count (confirmed: present, pointing at the same
// `offset=1000`, on both an empty-this-year real takeoff and a 63-flight one), is deliberately
// never followed either: its unit is not documented and is not row count (see
// docs/flightlog-api.md), so chasing it could as easily request the same page twice as reveal
// a genuine second page. The one default response this function is handed is treated as
// complete for the year.
//
// Cannot, on its own, tell "a real takeoff with zero flights this year" apart from "no such
// start_id" — both render this exact table, header and all, with zero 6-cell rows (confirmed:
// `fixtures/a42-119-flights.html` and `fixtures/a42-nonexistent-flights.html` are identical in
// every way that matters to this function). That distinction is deliberately NOT this parser's
// job: it lives in parseTakeoffDetail's breadcrumb-name check instead (see that module's own
// doc comment) — a page.tsx caller decides "not found" from THAT result, never from this one
// returning `[]`.
export function parseTakeoffFlights(html: string): TakeoffFlight[] {
  const $ = cheerio.load(html)
  const table = $(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    throw new Error('Takeoff flights markup not recognised: no results table found')
  }

  const rows = table.find('tr').toArray().map((row) => $(row))

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

  const flights = candidates.map(({ cells, date }) => toFlight(cells, date)).filter((flight): flight is TakeoffFlight => flight !== null)

  // Same floor check every other parser in this file family uses: a row that looked like a
  // flight but failed strict extraction is a defect, not a smaller flight count.
  if (flights.length !== candidates.length) {
    throw new Error(`Takeoff flights partially unparsed: ${flights.length}/${candidates.length} rows recognised`)
  }

  return flights
}
