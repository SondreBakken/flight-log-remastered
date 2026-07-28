import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { SiteRecord, SiteRecordClass, TakeoffDetail } from './types'

// Same table style clubs (a=25) and the generic takeoff index (a=23) both use — see
// parse-clubs.ts's own comment, which called this selector "unique to this table across every
// fixture on hand" before a=22/a=23 were sampled. It is not unique site-wide after all; it is
// unique to THIS response family only in combination with REQUIRED_LABELS below, which is what
// actually tells a genuine a=22 detail page apart from a=23's country index (same table shape,
// rows are `<a>Country</a>`/count pairs, none of the labels below) or a=25's club list (rows
// are `<a>Club</a>`/count pairs) — both fetched by this app for their own routes, never by this
// parser, but the distinction still has to hold structurally, not by trusting the URL we asked
// for.
const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="black"]'

// Present on every real a=22 response sampled (a populated takeoff, a minimal one, and even
// the nonexistent-start_id shell) — "region" and "Link to more info" are NOT in this list on
// purpose: region is genuinely absent for a real takeoff flightlog.org never assigned one to
// (the same regionId-0 case the takeoffs directory already handles, see UNREGIONED_LABEL), and
// "Link to more info" only renders when a takeoff actually has one. Neither can be required
// without turning a legitimate real takeoff into a false "unrecognised markup" throw.
const REQUIRED_LABELS = ['Altitude', 'Description', 'Siterecord', 'created', 'Updated']

// The breadcrumb's fourth `<span style='font-style:italic;'>` — Home / Takeoffs / Country /
// <takeoff name> in document order. A nonexistent start_id's response renders only the first
// three (confirmed live: 3 spans, not 4, for a bad id, vs. 4 for every real takeoff sampled,
// including one with an otherwise near-empty detail table) — the take-off's own name is the
// one field a bad id can never fake, which is exactly why it is the signal used here rather
// than any of the label/value rows themselves (see docs/flightlog-api.md's "Measured signal"
// note: row emptiness alone cannot tell a real takeoff with sparse data apart from a bad id).
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

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readTripId(href: string | undefined): number | null {
  const match = href?.match(/trip_id=(\d+)/)
  return match ? Number(match[1]) : null
}

// Maps every `<tr>` with exactly two `<td>`s to its label/value pair — rows that don't fit
// that shape (the Holfuy map link, the embedded weather-widget iframe, both `colspan='2'`) are
// simply not label/value data and are skipped, not treated as a parse failure.
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

// The description cell packs a wind-compass image and (sometimes) a start-photo thumbnail
// ahead of the actual text, with `<br>` as the only paragraph separator flightlog.org ever
// emits — the exact same shape parsePilot's profile block already handles (see
// parse-flights.ts), split on `<br>` and reloaded fragment-by-fragment so each fragment's own
// `.text()` drops any inline markup (images, the rare embedded link) while keeping line
// breaks. Rendered as plain text on the page, not `dangerouslySetInnerHTML`: this is
// unsanitised third-party HTML from flightlog.org, this repo has no HTML sanitiser dependency,
// and every other free-text field already scraped from this site (club names, pilot notes,
// flight notes) goes through the same `.text()`-only treatment — introducing a sanitiser for
// this one field alone would be a new dependency for a single call site, not a consistent
// policy.
function readDescription(cell: Nodes): string {
  const html = cell.html() ?? ''
  const lines = html
    .split(/<br\s*\/?>/i)
    .map((fragment) => cheerio.load(fragment).text().trim())
    .filter((line) => line !== '')
  return lines.join('\n')
}

// "PG: <a>Name, 196.9 Km</a>&nbsp;&nbsp;HG: <a>...". The class label (PG/HG/HG2) is a bare
// text node immediately before its anchor, not an attribute or wrapping element — cheerio's
// raw node `.prev` (not the jQuery-style `.prev()`, which only walks ELEMENT siblings and
// would skip straight past this text node to nothing) is what actually reaches it.
function readSiteRecordClass(anchor: Nodes): SiteRecordClass | null {
  const previous = anchor.get(0)?.prev
  if (!previous || previous.type !== 'text') return null
  const label = previous.data.trim().replace(/:$/, '').trim()
  return label === 'PG' || label === 'HG' || label === 'HG2' ? label : null
}

// "Mikael Benjamin Ulstrup, 196.9 Km" — pilot name and distance share one anchor with no
// other markup to split on but the last comma.
function readSiteRecordNameAndDistance(text: string): { pilotName: string; distanceKm: number } | null {
  const match = text.match(/^(.*),\s*([\d.,]+)\s*Km$/i)
  if (!match) return null
  const pilotName = textOrNull(match[1])
  const distanceKm = readNumber(match[2])
  if (pilotName === null || distanceKm === null) return null
  return { pilotName, distanceKm }
}

// Zero extra requests: every site record's link carries a `trip_id` (usable as a flight-detail
// href) but no `user_id` — a follow button needs a `user_id` this row never has, so the pilot
// name here is text, not a follow target, per #11's own scope note.
function readSiteRecords($: ReturnType<typeof cheerio.load>, cell: Nodes): SiteRecord[] {
  const records: SiteRecord[] = []
  cell.find('a').each((_, el) => {
    const anchor = $(el)
    const tripId = readTripId(anchor.attr('href'))
    const recordClass = readSiteRecordClass(anchor)
    const nameAndDistance = readSiteRecordNameAndDistance(anchor.text().trim())
    if (tripId !== null && recordClass !== null && nameAndDistance !== null) {
      records.push({ recordClass, tripId, ...nameAndDistance })
    }
  })
  return records
}

// Throws for markup this parser cannot recognise at all (see RESULTS_TABLE_SELECTOR/
// REQUIRED_LABELS above); returns null for markup it recognises perfectly well as "flightlog.org
// has no takeoff at this id" (an empty breadcrumb name — see BREADCRUMB_SPAN_SELECTOR). Those
// are different failures and must stay different: a page.tsx caller reacts to the first with a
// thrown error, and to the second with `notFound()` — collapsing them into the same return
// shape would make a genuinely broken parser indistinguishable from an ordinary 404.
export function parseTakeoffDetail(html: string, takeoffId: number): TakeoffDetail | null {
  const $ = cheerio.load(html)
  const table = $(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    throw new Error(`Takeoff detail markup not recognised for takeoff ${takeoffId}: no results table found`)
  }

  const rows = labelledRows($, table)
  const missingLabels = REQUIRED_LABELS.filter((label) => !rows.has(label))
  if (missingLabels.length > 0) {
    throw new Error(
      `Takeoff detail markup not recognised for takeoff ${takeoffId}: missing expected field(s) [${missingLabels.join(', ')}]`,
    )
  }

  const name = readBreadcrumbName($)
  if (name === null) return null

  const linkCell = rows.get('Link to more info')
  const descriptionCell = rows.get('Description')!
  const siteRecordCell = rows.get('Siterecord')!

  return {
    takeoffId,
    name,
    region: rows.has('region') ? textOrNull(rows.get('region')!.text()) : null,
    altitude: textOrNull(rows.get('Altitude')!.text()),
    description: readDescription(descriptionCell),
    linkUrl: linkCell ? (linkCell.find('a').first().attr('href') ?? null) : null,
    createdAt: dateOrNull(rows.get('created')!.text()),
    updatedAt: dateOrNull(rows.get('Updated')!.text()),
    siteRecords: readSiteRecords($, siteRecordCell),
  }
}
