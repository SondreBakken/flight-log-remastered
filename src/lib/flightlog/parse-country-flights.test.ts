import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCountryFlightDays, parseCountryFlights } from './parse-country-flights'

// Trimmed from live GETs of `a=47&country_id=160` on 2026-11-10 (pilots, clubs and ids replaced with synthetic values): the bare page (only the newest
// day, one flight) and its `tripdate=2026-11-09` day page (flights under 2-cell takeoff-name rows).
const BARE_HTML = readFileSync(join(__dirname, 'fixtures/a47-country-160.html'), 'utf8')
const DAY_HTML = readFileSync(join(__dirname, 'fixtures/a47-country-160-2026-11-09.html'), 'utf8')

const EMPTY_TABLE_HTML = `<html><body><h3>Flights - Norway</h3>
<table cellspacing='1' cellpadding='2' bgcolor='#22aa00'><tr><td bgcolor='white'></td><td bgcolor='white' colspan='4'></td><td bgcolor='white'></td></tr></table></body></html>`

const BROKEN_ROW_HTML = `<html><body><table cellspacing='1' cellpadding='2' bgcolor='#22aa00'>
<tr><td bgcolor='white' colspan='6'><b>2026-11-09</b></td></tr>
<tr><td>10:00</td><td></td><td>no pilot link</td><td>00:10</td><td></td><td></td></tr>
</table></body></html>`

describe('parseCountryFlights', () => {
  it('parses the bare page: the lone newest flight with a blank distance as null', () => {
    expect(parseCountryFlights(BARE_HTML, 160)).toEqual([
      {
        tripId: 9000001,
        userId: 900001,
        pilotName: 'Pilot One',
        club: null,
        glider: 'Ozone Alta',
        duration: '00:09',
        distanceKm: null,
        note: null,
        date: '2026-11-10',
        timeOfDay: null,
      },
    ])
  })

  it('parses a day page: skips the takeoff-name rows and carries the date onto every flight row', () => {
    const flights = parseCountryFlights(DAY_HTML, 160)

    expect(flights.map((flight) => flight.tripId)).toEqual([9000002, 9000003, 9000004, 9000005])
    expect(new Set(flights.map((flight) => flight.date))).toEqual(new Set(['2026-11-09']))
    expect(flights[0]).toMatchObject({
      pilotName: 'Pilot Two',
      club: 'Example Club A',
      glider: 'Ozone Zeolite 2',
      distanceKm: 2.9,
      timeOfDay: '12:50',
    })
  })

  it('returns [] for a table with no flight rows', () => {
    expect(parseCountryFlights(EMPTY_TABLE_HTML, 160)).toEqual([])
  })

  it('throws when the page has no results table', () => {
    expect(() => parseCountryFlights('<html><body>blocked</body></html>', 160)).toThrow(/no results table/)
  })

  it('throws when a 6-cell row fails strict extraction', () => {
    expect(() => parseCountryFlights(BROKEN_ROW_HTML, 160)).toThrow(/0\/1 rows recognised/)
  })
})

describe('parseCountryFlightDays', () => {
  it('lists the index days newest first, without the whole-year entry', () => {
    const html = `<html><body>2026-11-10 : <a href='x&year=2026&tripdate=2026-11-10'>1 flights</a><br>
2026-11-09 : <a href='x&year=2026&tripdate=2026-11-09'>10 flights</a><br>
2026 : <a href='x&year=2026&tripdate=2026-00-00'>231 flights</a><br></body></html>`

    expect(parseCountryFlightDays(html)).toEqual(['2026-11-10', '2026-11-09'])
  })

  it('reads the index from the committed bare-page fixture', () => {
    expect(parseCountryFlightDays(BARE_HTML)).toEqual(['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07'])
  })
})
