import { describe, expect, it } from 'vitest'
import { parseRegions } from './parse-regions'

// Trimmed from the real `rqtid=10&country_id=160` response, with a real quirk preserved:
// Brumunddal carries all-zero `createdby`/`createdtime`/`updatedby`/`updatedtime`
// (`0000-00-00 00:00:00`) — a genuine "system" region on the live site, not a parsing
// artefact — which is exactly why those metadata fields are trimmed rather than carried
// (see types.ts). One row is a constructed duplicate of region id 2, proving dedupe.
const REGIONS_HTML = `<html><body><table border=1><th>country_id</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><tr><td>160</td><td>1</td><td>2001-02-23 10:41:35</td><td>2</td><td>Akershus</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-23 10:41:35</td></tr>
<tr><td>160</td><td>0</td><td>0000-00-00 00:00:00</td><td>152</td><td>Brumunddal</td><td>2002-09-16 13:38:02</td><td>0</td><td>0000-00-00 00:00:00</td></tr>
<tr><td>160</td><td>1</td><td>2001-02-23 10:41:35</td><td>10</td><td>Nord-Trøndelag</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-28 13:10:26</td></tr>
<tr><td>160</td><td>1</td><td>2001-02-23 10:41:35</td><td>2</td><td>Akershus (duplicate)</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-23 10:41:35</td></tr>
</table></body></html>`

// The real, verbatim `rqtid=10&country_id=29` (Bouvet Island) response: header-only, zero
// <tr> data rows.
const EMPTY_COUNTRY_HTML =
  '<html><body><table border=1><th>country_id</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th></table></body></html>'

// The real, verbatim `rqtid=11&country_id=29` (Bouvet Island takeoffs) response — shares the
// identical bare `<table border=1>` shape as rqtid=10 but a different, 10-field header. Proof
// the header-order check (not merely table presence) is what tells a genuine empty region
// list apart from a different rqtid's response sharing its container shape.
const WRONG_ENDPOINT_HTML =
  '<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th></table></body></html>'

// A stray, unrelated table ahead of the real results table — not observed on the live site,
// but the container selector should not depend on it never appearing.
const DECOY_TABLE_FIRST_HTML = `<html><body><table><tr><td>unrelated</td></tr></table><table border=1><th>country_id</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><tr><td>160</td><td>1</td><td>2001-02-23 10:41:35</td><td>2</td><td>Akershus</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-23 10:41:35</td></tr>
</table></body></html>`

// Same 8 field names as REGION_HEADER, same count, but `id` and `name` swapped — a column
// reorder on the live site, not a field being added or removed. Regression guard for the
// header check degrading to a count-only comparison: same length would pass, but the values
// under `id`/`name` would then be silently swapped for every row.
const REORDERED_HEADER_HTML =
  '<html><body><table border=1><th>country_id</th><th>createdby</th><th>createdtime</th><th>name</th><th>id</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><tr><td>160</td><td>1</td><td>2001-02-23 10:41:35</td><td>2</td><td>Akershus</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-23 10:41:35</td></tr></table></body></html>'

describe('parseRegions', () => {
  it('finds the results table by its border="1" attribute, ignoring an unrelated table that precedes it', () => {
    // Regression guard for the container selector degrading to a bare `table` (any table,
    // first match wins) — see parse-takeoffs.test.ts for the full reasoning.
    expect(parseRegions(DECOY_TABLE_FIRST_HTML, 160)).toEqual([{ regionId: 2, name: 'Akershus', countryId: 160 }])
  })

  it('reads region id, name and country id, trimming metadata fields; dedupes a repeated id', () => {
    const regions = parseRegions(REGIONS_HTML, 160)

    expect(regions).toEqual([
      { regionId: 2, name: 'Akershus', countryId: 160 },
      { regionId: 152, name: 'Brumunddal', countryId: 160 },
      { regionId: 10, name: 'Nord-Trøndelag', countryId: 160 },
    ])
  })

  it('returns an empty list — not a throw — for a country whose header-only response has no data rows', () => {
    expect(parseRegions(EMPTY_COUNTRY_HTML, 29)).toEqual([])
  })

  it('throws rather than returning an empty list when the results table is missing entirely', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseRegions(unrecognisedHtml, 999)).toThrow()
  })

  it('throws when a response sharing the bare-table shape carries the wrong header, even with zero data rows', () => {
    expect(() => parseRegions(WRONG_ENDPOINT_HTML, 29)).toThrow()
  })

  it('throws when the header has the right field count but a reordered field name, instead of silently swapping values', () => {
    // Regression guard for the header check degrading to `actualHeader.length ===
    // expectedHeader.length` alone — every other negative case here differs in field *count*,
    // so none exercises the per-position equality check this one pins.
    expect(() => parseRegions(REORDERED_HEADER_HTML, 160)).toThrow()
  })

  it('throws rather than silently dropping a row when an extra cell shifts the field mapping', () => {
    const shiftedCellHtml = `<html><body><table border=1><th>country_id</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><tr><td>160</td><td>extra</td><td>1</td><td>2001-02-23 10:41:35</td><td>2</td><td>Akershus</td><td>2002-03-18 02:18:49</td><td>1</td><td>2001-02-23 10:41:35</td></tr></table></body></html>`

    expect(() => parseRegions(shiftedCellHtml, 160)).toThrow()
  })
})
