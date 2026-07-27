import { describe, expect, it } from 'vitest'
import { parseClubs } from './parse-clubs'

// Trimmed from the real `a=25&country_id=160` response, with real quirks preserved: the
// malformed trailing `</a>` after the flight-count cell (needs cheerio, not a strict
// parser), non-ASCII in a name (Ålesund), an HTML entity in a name (Alta Hang &amp;
// Paragliderklubb), and a genuine zero-flight club (Salangen). Three rows are constructed
// rather than lifted verbatim: a duplicate `club_id=53` row, a honeypot-shaped row placed
// *inside* the results table (real traps only ever appear in the shared nav chrome above
// it — this proves the parser rejects one by its markers even when structural position
// alone would not save it), and a row for a club that lists its own website before its
// flightlog link (real clubs do this) — this proves `findClubAnchor` picks the `club_id=`
// anchor specifically, not just the first anchor in the row.
const CLUBS_HTML = `<html><body>
<table width='96%'><tr><td><a href='/resources/546b6d9d1a350c66' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a></td></tr></table>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='3' bgcolor='black'>
<tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>1</a></td></tr>
<tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=31'>Ålesund Paragliderklubb</a></td><td bgcolor='white'>77</a></td></tr>
<tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=42'>Alta Hang &amp; Paragliderklubb</a></td><td bgcolor='white'>8</a></td></tr>
<tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=6'>Salangen Paragliderklubb</a></td><td bgcolor='white'>0</a></td></tr>
<tr><td bgcolor='white'><a href='/fl.html?a=26&club_id=999' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a></td><td bgcolor='white'>0</a></td></tr>
<tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb (duplicate row)</a></td><td bgcolor='white'>1</a></td></tr>
<tr><td bgcolor='white'><a href='http://www.bergen-pgklubb.no' target='_blank'>www.bergen-pgklubb.no</a> <a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=77'>Bergen Paragliderklubb</a></td><td bgcolor='white'>15</a></td></tr>
</table>
</div>
</body></html>`

// Trimmed from the real `a=25&country_id=29` (Bouvet Island) response: same page shell,
// the results table is present but has zero rows.
const EMPTY_COUNTRY_HTML = `<html><body>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</div>
</body></html>`

describe('parseClubs', () => {
  it('reads club id, name and flight count; excludes an in-table honeypot; ignores a preceding non-club anchor; dedupes a repeated club id', () => {
    const clubs = parseClubs(CLUBS_HTML, 160)

    expect(clubs).toEqual([
      { clubId: 53, name: 'Albatross Aero Klubb', flightCount: 1 },
      { clubId: 31, name: 'Ålesund Paragliderklubb', flightCount: 77 },
      { clubId: 42, name: 'Alta Hang & Paragliderklubb', flightCount: 8 },
      { clubId: 6, name: 'Salangen Paragliderklubb', flightCount: 0 },
      { clubId: 77, name: 'Bergen Paragliderklubb', flightCount: 15 },
    ])
  })

  it('returns an empty list — not a throw — for a country whose results table is present but has no rows', () => {
    expect(parseClubs(EMPTY_COUNTRY_HTML, 29)).toEqual([])
  })

  it('throws rather than returning an empty list when the results table is missing entirely', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseClubs(unrecognisedHtml, 999)).toThrow()
  })

  it('throws for page chrome sharing the old, too-generic div wrapper but not the results table', () => {
    // Regression guard for the previous container anchor (`div[style*="padding:0px 10px"]`),
    // which every standard page shell carries — including pilot pages, which have no club
    // rows at all. Anchoring on that div alone used to return `[]` here instead of throwing.
    const pilotPageChromeHtml = `<html><body><div style='padding:0px 10px'><table><tr><td>not a club list</td></tr></table></div></body></html>`

    expect(() => parseClubs(pilotPageChromeHtml, 4549)).toThrow()
  })

  it('throws rather than silently returning an empty list when every row uses an unexpected action code', () => {
    // Candidate detection keys on `club_id=` alone, independent of the expected action
    // code, so a drifted code (26 -> 27 here) still counts the row as a candidate that
    // failed to parse, rather than simply not matching it in the first place.
    const wrongActionHtml = `<html><body><div style='padding:0px 10px'><table cellspacing='1' cellpadding='3' bgcolor='black'>
    <tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=27&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>1</a></td></tr>
    </table></div></body></html>`

    expect(() => parseClubs(wrongActionHtml, 160)).toThrow()
  })

  it('throws rather than silently dropping a row when an extra cell shifts the flight-count column', () => {
    const shiftedCellHtml = `<html><body><div style='padding:0px 10px'><table cellspacing='1' cellpadding='3' bgcolor='black'>
    <tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>extra</td><td bgcolor='white'>1</a></td></tr>
    </table></div></body></html>`

    expect(() => parseClubs(shiftedCellHtml, 160)).toThrow()
  })

  it('throws rather than misreading a comma-formatted flight count as a decimal', () => {
    const commaFlightCountHtml = `<html><body><div style='padding:0px 10px'><table cellspacing='1' cellpadding='3' bgcolor='black'>
    <tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>1,234</td></tr>
    </table></div></body></html>`

    expect(() => parseClubs(commaFlightCountHtml, 160)).toThrow()
  })
})
