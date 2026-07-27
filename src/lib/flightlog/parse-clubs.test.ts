import { describe, expect, it } from 'vitest'
import { parseClubs } from './parse-clubs'

// Trimmed from the real `a=25&country_id=160` response: the malformed trailing `</a>`
// after the flight-count cell is real markup (needs cheerio, not a strict parser), and
// the honeypot link lives only in the shared nav chrome above the results container,
// never inside it — it has no `a=26` in its href so it cannot be picked up by the
// `a[href*="a=26"]` selector regardless.
const CLUBS_HTML = `<html><body>
<table width='96%'><tr><td><a href='/resources/546b6d9d1a350c66' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a></td></tr></table>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>1</a></td></tr><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=32'>Jetta Luftsportsklubb</a></td><td bgcolor='white'>18</a></td></tr><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=33'>Oslo Paragliderklubb </a></td><td bgcolor='white'>677</a></td></tr></table>
</div>
</body></html>`

// Trimmed from the real `a=25&country_id=29` (Bouvet Island) response: same page shell,
// the results container is present but its table has zero rows.
const EMPTY_COUNTRY_HTML = `<html><body>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</div>
</body></html>`

describe('parseClubs', () => {
  it('reads club id from the href, name from the link text, flight count from the sibling cell', () => {
    const clubs = parseClubs(CLUBS_HTML, 160)

    expect(clubs).toEqual([
      { clubId: 53, name: 'Albatross Aero Klubb', flightCount: 1 },
      { clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 },
      { clubId: 33, name: 'Oslo Paragliderklubb', flightCount: 677 },
    ])
  })

  it('returns an empty list — not a throw — for a country whose results table is present but has no rows', () => {
    expect(parseClubs(EMPTY_COUNTRY_HTML, 29)).toEqual([])
  })

  it('throws rather than returning an empty list when the results container is missing entirely', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseClubs(unrecognisedHtml, 999)).toThrow()
  })
})
