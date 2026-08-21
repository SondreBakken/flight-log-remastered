import * as cheerio from 'cheerio'
import type { Nodes } from './parse-flightlog-table'
import type { SiteRecord, SiteRecordClass, TakeoffDetail } from './types'
import { readIdFromHref } from './parse-takeoff-flights'

// The same table shape a=25 (clubs) and a=23 (generic takeoffs index) both use — not unique by
// itself; REQUIRED_LABELS below is what actually tells a genuine a=22 detail page apart from
// those two siblings. See docs/flightlog-api.md's "Takeoff detail (a=22)" section.
const RESULTS_TABLE_SELECTOR = 'table[cellspacing="1"][cellpadding="3"][bgcolor="black"]'

// Present on every real a=22 response sampled (a populated takeoff, a minimal one, and even
// the nonexistent-start_id shell) — "region" and "Link to more info" are NOT in this list on
// purpose: "Link to more info" only renders when a takeoff actually has one, confirmed live.
// region is INFERRED, not measured, to be absent for a takeoff with regionId 0 (the same case
// the takeoffs directory handles, see UNREGIONED_LABEL) — no fixture on hand demonstrates it;
// all three real fixtures sampled carry a region row. Kept defensive on that inference: if
// wrong, this parser just tolerates a row it didn't strictly need, rather than throwing on a
// real takeoff.
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

// A label absent from `rows` (an optional field flightlog.org only sometimes renders — region,
// Altitude, created, Updated all go through this) reads as null, not a missing-field error;
// REQUIRED_LABELS above is what already guarantees the labels this function is actually called
// with are present for a real takeoff.
function readLabelledText(rows: Map<string, Nodes>, label: string, transform: (raw: string) => string | null = textOrNull): string | null {
  const cell = rows.get(label)
  return cell ? transform(cell.text()) : null
}

function readBreadcrumbName($: ReturnType<typeof cheerio.load>): string | null {
  const spans = $(BREADCRUMB_SPAN_SELECTOR)
  if (spans.length <= BREADCRUMB_NAME_INDEX) return null
  return textOrNull($(spans.get(BREADCRUMB_NAME_INDEX)).text())
}

// The description cell packs a wind-compass image and (sometimes) a start-photo thumbnail
// ahead of the actual text, split on `<br>` (flightlog.org's only paragraph separator) and
// reloaded fragment-by-fragment so each fragment's own `.text()` drops the inline markup while
// keeping line breaks. Rendered as plain text on the page, not `dangerouslySetInnerHTML`: this
// is unsanitised third-party HTML, this repo has no HTML sanitiser dependency, and every other
// free-text field already scraped from this site goes through the same `.text()`-only
// treatment — introducing a sanitiser for this one field alone would be a new dependency for a
// single call site, not a consistent policy.
function readDescription(cell: Nodes): string | null {
  const html = cell.html() ?? ''
  const lines = html
    .split(/<br\s*\/?>/i)
    .map((fragment) => cheerio.load(fragment).text().trim())
    .filter((line) => line !== '')
  return lines.length > 0 ? lines.join('\n') : null
}

// "PG: <a>Name, 196.9 Km</a>&nbsp;&nbsp;HG: <a>...". The class label (PG/HG/HG2) is a bare
// text node immediately before its anchor, not an attribute or wrapping element — cheerio's
// raw node `.prev` (not the jQuery-style `.prev()`, which only walks ELEMENT siblings and
// would skip straight past this text node to nothing) is what actually reaches it.
const SITE_RECORD_CLASSES: readonly SiteRecordClass[] = ['PG', 'HG', 'HG2', 'PPG', 'PHG']

// #235: a takeoff with a powered-flight record (PPG/PHG), not just the free-flight PG/HG/HG2
// trio every fixture sampled for this parser originally had, threw "not recognised" here —
// those two labels are real flightlog.org markup, not malformed input the strict-extraction
// floor check in readSiteRecords is meant to catch.
function readSiteRecordClass(anchor: Nodes): SiteRecordClass | null {
  const previous = anchor.get(0)?.prev
  if (!previous || previous.type !== 'text') return null
  const label = previous.data.trim().replace(/:$/, '').trim()
  return (SITE_RECORD_CLASSES as readonly string[]).includes(label) ? (label as SiteRecordClass) : null
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

function toSiteRecord(anchor: Nodes): SiteRecord | null {
  const tripId = readIdFromHref(anchor.attr('href'), 'trip_id')
  const recordClass = readSiteRecordClass(anchor)
  const nameAndDistance = readSiteRecordNameAndDistance(anchor.text().trim())
  if (tripId === null || recordClass === null || nameAndDistance === null) return null
  return { recordClass, tripId, ...nameAndDistance }
}

// Zero extra requests: every site record's link carries a `trip_id` (usable as a flight-detail
// href) but no `user_id` — a follow button needs a `user_id` this row never has, so the pilot
// name here is text, not a follow target, per #11's own scope note.
//
// Same floor check parseTakeoffFlights uses: an anchor that looked like a site record but
// failed strict extraction is a defect, not a smaller record count.
function readSiteRecords($: ReturnType<typeof cheerio.load>, cell: Nodes, takeoffId: number): SiteRecord[] {
  const anchors = cell.find('a').toArray().map((el) => $(el))
  const records = anchors.map(toSiteRecord).filter((record): record is SiteRecord => record !== null)

  if (records.length !== anchors.length) {
    throw new Error(
      `Takeoff detail markup not recognised for takeoff ${takeoffId}: ${records.length}/${anchors.length} site record(s) recognised`,
    )
  }
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
    region: readLabelledText(rows, 'region'),
    altitude: readLabelledText(rows, 'Altitude'),
    description: readDescription(descriptionCell),
    linkUrl: linkCell ? (linkCell.find('a').first().attr('href') ?? null) : null,
    createdAt: readLabelledText(rows, 'created', dateOrNull),
    updatedAt: readLabelledText(rows, 'Updated', dateOrNull),
    siteRecords: readSiteRecords($, siteRecordCell, takeoffId),
  }
}
