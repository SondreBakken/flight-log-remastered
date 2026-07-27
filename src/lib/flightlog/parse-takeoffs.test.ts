import { describe, expect, it } from 'vitest'
import { parseTakeoffs } from './parse-takeoffs'

// Trimmed from the real `rqtid=11&country_id=160` response, with real quirks preserved: a
// leading tab in a name (`\tJorde på Løten, Klæpa airport`), a genuine negative latitude
// (`Auenhaugen` — a data-entry glitch on the live site, not a transcription error), and
// `wind=255` (the max of the confirmed 0-255 range). One row is a constructed duplicate of
// takeoff id 6246, proving dedupe.
const TAKEOFFS_HTML = `<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>\tJorde på Løten, Klæpa airport</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr>
<tr><td>10778</td><td>Auenhaugen, Golsfjellet - Gol</td><td>-1.01694444</td><td>1.01694444</td><td>129</td><td>160</td><td>4</td><td>0</td><td>1119</td><td>0</td></tr>
<tr><td>6250</td><td>  Trysil, Lerberget</td><td>0.00000000</td><td>0.00000000</td><td>255</td><td>160</td><td>6</td><td>0</td><td>355</td><td>0</td></tr>
<tr><td>6246</td><td>Duplicate of Jorde på Løten</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr>
</table></body></html>`

// The real, verbatim `rqtid=11&country_id=29` (Bouvet Island) response: header-only, zero
// <tr> data rows, no page shell — same "plainest response on the site" shape rqtid=9 uses.
const EMPTY_COUNTRY_HTML =
  "<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th></table></body></html>"

// The real, verbatim `rqtid=8` response (full takeoff schema doc — never fetched in
// production). Shares the identical bare `<table border=1>` shape as rqtid=11 but a
// different, 24-field header — proof the header-order check (not merely table presence)
// is what tells a genuine empty takeoff list apart from an unrelated response sharing its
// container shape.
const SCHEMA_DOC_HTML =
  "<html><body><table border=1><th>altitude</th><th>altitudediff</th><th>country_id</th><th>createdby</th><th>createdname</th><th>createdtime</th><th>description</th><th>id</th><th>img_id</th><th>lat</th><th>lon</th><th>name</th><th>region_id</th><th>subregion_id</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><th>url</th><th>wind</th><th>tracklog_id</th><th>img_key</th><th>country_name</th><th>region_name</th><th>subregion_name</th></table></body></html>"

// A stray, unrelated table ahead of the real results table — not observed on the live site,
// but the container selector should not depend on it never appearing.
const DECOY_TABLE_FIRST_HTML = `<html><body><table><tr><td>unrelated</td></tr></table><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>Jorde på Løten</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr>
</table></body></html>`

// Same 10 field names as TAKEOFF_HEADER, same count, but `lat` and `lon` swapped — a column
// reorder on the live site, not a field being added or removed. Regression guard for the
// header check degrading to a count-only comparison: same length would pass, but the values
// under `lat`/`lon` would then be silently swapped for every row.
const REORDERED_HEADER_HTML =
  '<html><body><table border=1><th>id</th><th>name</th><th>lon</th><th>lat</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>Jorde på Løten</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr></table></body></html>'

// A negative altitudediff (landing above takeoff) is physically real and wasn't ruled out by
// sampling one country — readSignedInteger has to accept it, not just a bare `\d+`.
const NEGATIVE_ALTITUDEDIFF_HTML =
  '<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>Jorde på Løten</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>-40</td></tr></table></body></html>'

describe('parseTakeoffs', () => {
  it('finds the results table by its border="1" attribute, ignoring an unrelated table that precedes it', () => {
    // Regression guard for the container selector degrading to a bare `table` (any table,
    // first match wins): a stray decoy table ahead of the real results table would then be
    // picked instead, and its header mismatch would throw — even though the real takeoff
    // table further down the document is perfectly well-formed.
    expect(parseTakeoffs(DECOY_TABLE_FIRST_HTML, 160)).toEqual([
      { takeoffId: 6246, name: 'Jorde på Løten', lat: 60.79527778, lon: 11.34555556, wind: 56, countryId: 160, regionId: 6, subregionId: 0, altitude: 180, altitudeDiff: 0 },
    ])
  })

  it('reads id, name, coordinates, wind, region/subregion and altitude fields; dedupes a repeated id', () => {
    const takeoffs = parseTakeoffs(TAKEOFFS_HTML, 160)

    expect(takeoffs).toEqual([
      { takeoffId: 6246, name: 'Jorde på Løten, Klæpa airport', lat: 60.79527778, lon: 11.34555556, wind: 56, countryId: 160, regionId: 6, subregionId: 0, altitude: 180, altitudeDiff: 0 },
      { takeoffId: 10778, name: 'Auenhaugen, Golsfjellet - Gol', lat: -1.01694444, lon: 1.01694444, wind: 129, countryId: 160, regionId: 4, subregionId: 0, altitude: 1119, altitudeDiff: 0 },
      { takeoffId: 6250, name: 'Trysil, Lerberget', lat: 0, lon: 0, wind: 255, countryId: 160, regionId: 6, subregionId: 0, altitude: 355, altitudeDiff: 0 },
    ])
  })

  it('returns an empty list — not a throw — for a country whose header-only response has no data rows', () => {
    expect(parseTakeoffs(EMPTY_COUNTRY_HTML, 29)).toEqual([])
  })

  it('throws rather than returning an empty list when the results table is missing entirely', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseTakeoffs(unrecognisedHtml, 999)).toThrow()
  })

  it('throws when a response sharing the bare-table shape carries the wrong header, even with zero data rows', () => {
    // Regression guard for a header-shape check that degrades to "any table is present" —
    // rqtid=8's real response would otherwise parse as a genuinely empty takeoff list.
    expect(() => parseTakeoffs(SCHEMA_DOC_HTML, 4)).toThrow()
  })

  it('throws when the header has the right field count but a reordered field name, instead of silently swapping values', () => {
    // Regression guard for the header check degrading to `actualHeader.length ===
    // expectedHeader.length` alone — both other negative cases here differ in field *count*,
    // so neither exercises the per-position equality check this one pins.
    expect(() => parseTakeoffs(REORDERED_HEADER_HTML, 160)).toThrow()
  })

  it('accepts a negative altitudediff, not just a bare unsigned integer', () => {
    // Regression guard for readSignedInteger degrading to `^\d+$` — landing above takeoff is
    // physically real and wasn't ruled out by sampling one country.
    expect(parseTakeoffs(NEGATIVE_ALTITUDEDIFF_HTML, 160)).toEqual([
      { takeoffId: 6246, name: 'Jorde på Løten', lat: 60.79527778, lon: 11.34555556, wind: 56, countryId: 160, regionId: 6, subregionId: 0, altitude: 180, altitudeDiff: -40 },
    ])
  })

  it('throws rather than silently dropping a row when an extra cell shifts the field mapping', () => {
    const shiftedCellHtml = `<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>Jorde på Løten</td><td>extra</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr></table></body></html>`

    expect(() => parseTakeoffs(shiftedCellHtml, 160)).toThrow()
  })

  it('throws rather than misreading a non-numeric wind value', () => {
    const badWindHtml = `<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>Jorde på Løten</td><td>60.79527778</td><td>11.34555556</td><td>N</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr></table></body></html>`

    expect(() => parseTakeoffs(badWindHtml, 160)).toThrow()
  })
})
