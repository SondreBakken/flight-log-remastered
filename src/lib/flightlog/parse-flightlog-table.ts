import * as cheerio from 'cheerio'

export type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

// rqtid=9 (countries), rqtid=10 (regions) and rqtid=11 (takeoffs) all render the identical
// "plainest response on the site" shape (see docs/flightlog-api.md): no page shell, no nav,
// no honeypot, no links at all — just `<table border=1>` with an unwrapped `<th>` header
// cheerio synthesizes into a leading `<tr>`, followed by zero or more `<tr><td>…</td></tr>`
// data rows. Confirmed empirically for rqtid=9 (zero <a> tags, zero hp-nav occurrences), and
// for both rqtid=10 and rqtid=11 (Norway, country_id=160, and Bouvet Island, country_id=29 —
// same, in every capture of either endpoint).
const RESULTS_TABLE_SELECTOR = 'table[border="1"]'

function isDataRow(row: Nodes): boolean {
  return row.children('td').length > 0
}

function headerFields($: ReturnType<typeof cheerio.load>, row: Nodes): string[] {
  return row
    .children('th')
    .map((_, el) => $(el).text().trim())
    .get()
}

// Shared by parse-countries.ts, parse-regions.ts and parse-takeoffs.ts. Returns every
// candidate data row — callers still have to run their own strict per-row extraction and
// floor check on top, the same division of labour parse-clubs.ts and parse-pilot-search.ts
// use.
export function extractDataRows(html: string, expectedHeader: readonly string[], entityLabel: string): Nodes[] {
  const $ = cheerio.load(html)
  const table = $(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    throw new Error(`${entityLabel} markup not recognised: no results table found`)
  }

  const rows = table
    .find('tr')
    .toArray()
    .map((row) => $(row))
  const headerRow = rows.find((row) => row.children('th').length > 0)
  const actualHeader = headerRow ? headerFields($, headerRow) : []

  // The exact field NAMES in order — not merely a table being present, and not merely a
  // cell count — is the positive signal that this is genuinely the expected response and
  // not, say, a different rqtid's response sharing the identical bare-table shape, or a
  // column reorder on the live site silently swapping two fields. A country with zero real
  // rows for this entity still carries this header (confirmed: Bouvet Island's rqtid=11 and
  // rqtid=10 responses are header-only), which is what lets "zero rows" be trusted as a
  // genuine empty result rather than markup drift that happens to also yield zero rows —
  // the same distinction parse-clubs.ts draws with its results-table selector, made here
  // with the header contents instead since this response has no other structure to anchor on.
  const headerMatches =
    actualHeader.length === expectedHeader.length && actualHeader.every((field, i) => field === expectedHeader[i])
  if (!headerMatches) {
    throw new Error(
      `${entityLabel} markup not recognised: expected header [${expectedHeader.join(', ')}], got [${actualHeader.join(', ')}]`,
    )
  }

  return rows.filter(isDataRow)
}
