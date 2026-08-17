import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { FlightDetail } from './types'
import { readIdFromHref } from './parse-takeoff-flights'

// The page's single content container — the exact same `<div>` wraps both a real flight's
// results table AND a nonexistent `trip_id`'s literal `not found` text (see NOT_FOUND_TEXT
// below), so this is also what tells the two apart. See docs/flightlog-api.md's "Flight
// detail (a=34)" section.
const CONTENT_DIV_SELECTOR = 'div[style="padding:0px 10px"]'
const NOT_FOUND_TEXT = 'not found'

// a=34's own results table — `cellpadding='5'`, not `a=22`'s `cellpadding='3'` — otherwise the
// identical `cellspacing='1' bgcolor='black'` label/value shape this whole file family reuses.
const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="5"][bgcolor="black"]'

// Present as a ROW on every real trip sampled, tracked or not (fixtures a34-803981-detail.html,
// a34-1001964-detail.html) — a blank VALUE (e.g. `Distance (km)` / `Max altitude` on an
// untracked flight) is not the same as the row being absent, and only row presence is checked
// here. `Takeoff type` is deliberately excluded: every sample carries it, but nothing here
// confirms it can never be genuinely absent the way `region` was excluded from
// parse-takeoff-detail.ts's own REQUIRED_LABELS for the same reason.
const REQUIRED_LABELS = ['Date', 'Country', 'Takeoff', 'Glider brand and model', 'Duration', 'Distance (km)', 'Max altitude', 'Description']

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

// Maps every `<tr>` with exactly two `<td>`s to its label/value pair, same division of labour
// as parse-takeoff-detail.ts's own labelledRows — rows outside that shape (the malformed
// `Open distance`/`Best distance over 5 points` scoring rows a tracked flight's response
// interleaves between `Description` and `Takeoff type`, confirmed live) are simply skipped,
// not treated as a parse failure. Their malformed markup (missing an opening `<tr>`, real, not
// a transcription error) is exactly why label lookup by Map, not positional row index, is what
// this parser uses for every field below.
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

function cellText(rows: Map<string, Nodes>, label: string): string | null {
  const cell = rows.get(label)
  return cell ? textOrNull(cell.text()) : null
}

function cellNumber(rows: Map<string, Nodes>, label: string): number | null {
  const cell = rows.get(label)
  return cell ? readNumber(cell.text()) : null
}

// A tracked flight's Description cell appends flightlog.org's own auto-generated stats block
// (`<pre>Flight statistics\n…</pre>`) after the pilot's own free text — this parser is only
// ever called for an UNTRACKED flight (see flight-detail.ts's own doc comment), where no such
// block is present (confirmed: fixtures/a34-1001964-detail.html), so no attempt is made here to
// strip it out; it would simply flow through as extra lines if this were ever fed a tracked
// flight's markup. Same `<br>`-split-then-reload technique as parse-takeoff-detail.ts's
// readDescription, for the same reason: it drops inline markup (none present here, but kept
// consistent) while preserving the upstream `<br>` line breaks.
function readDescription(cell: Nodes): string | null {
  const html = cell.html() ?? ''
  const lines = html
    .split(/<br\s*\/?>/i)
    .map((fragment) => cheerio.load(fragment).text().trim())
    .filter((line) => line !== '')
  return lines.length > 0 ? lines.join('\n') : null
}

// The `Takeoff` cell's anchor carries the exact `country_id`/`start_id` pair `TakeoffRef`
// already models (see types.ts's own doc comment on that type) — a flight can, in principle,
// carry a takeoff name with no anchor or a malformed href (same reasoning `Flight.takeoffRef`
// already documents for the pilot-logbook scrape), so a missing ref here is a normal null, not
// a thrown error.
function readTakeoffRef(rows: Map<string, Nodes>): FlightDetail['takeoffRef'] {
  const href = rows.get('Takeoff')?.find('a').first().attr('href')
  const countryId = readIdFromHref(href, 'country_id')
  const takeoffId = readIdFromHref(href, 'start_id')
  return countryId === null || takeoffId === null ? null : { countryId, takeoffId }
}

// Throws for markup this parser cannot recognise at all (no content container, or a content
// container whose results table is missing some required field); returns null for markup it
// recognises perfectly well as "flightlog.org has no flight at this trip_id" (the content
// container's own literal `not found` text, rendered in place of any results table — confirmed
// live, fixtures/a34-nonexistent-detail.html). Those are different failures and must stay
// different, the same reasoning parseTakeoffDetail's own doc comment gives: a page.tsx caller
// reacts to the first with a thrown error, and to the second by falling back to the bare
// no-track notice — collapsing them would make a genuinely broken parser indistinguishable from
// an ordinary "no such trip".
export function parseFlightDetail(html: string, tripId: number): FlightDetail | null {
  const $ = cheerio.load(html)
  const contentDiv = $(CONTENT_DIV_SELECTOR).first()
  if (contentDiv.length === 0) {
    throw new Error(`Flight detail markup not recognised for trip ${tripId}: no content container found`)
  }

  const table = contentDiv.find(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    if (contentDiv.text().trim() === NOT_FOUND_TEXT) return null
    throw new Error(`Flight detail markup not recognised for trip ${tripId}: no results table found`)
  }

  const rows = labelledRows($, table)
  const missingLabels = REQUIRED_LABELS.filter((label) => !rows.has(label))
  if (missingLabels.length > 0) {
    throw new Error(
      `Flight detail markup not recognised for trip ${tripId}: missing expected field(s) [${missingLabels.join(', ')}]`,
    )
  }

  return {
    tripId,
    date: cellText(rows, 'Date'),
    country: cellText(rows, 'Country'),
    takeoff: cellText(rows, 'Takeoff'),
    takeoffRef: readTakeoffRef(rows),
    glider: cellText(rows, 'Glider brand and model'),
    duration: cellText(rows, 'Duration'),
    distanceKm: cellNumber(rows, 'Distance (km)'),
    maxAltitude: cellText(rows, 'Max altitude'),
    description: readDescription(rows.get('Description')!),
    takeoffType: cellText(rows, 'Takeoff type'),
  }
}
