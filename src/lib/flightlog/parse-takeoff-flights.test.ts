import { describe, expect, it } from 'vitest'
import { parseTakeoffFlights } from './parse-takeoff-flights'

// Trimmed from the real `a=42&country_id=160&start_id=179` response
// (fixtures/a42-179-flights.html): two date groups, a row with a club and a distance, and a
// row with neither (both real quirks — an unaffiliated pilot, and a flight logged with no
// recorded distance).
const POPULATED_HTML = `<html><body>
<h3>Flights - Drammen, Solbergåsen</h3>
<table cellspacing='1' cellpadding='2' bgcolor='#22aa00'>
<tr><td bgcolor='white'></td><td bgcolor='white' colspan='4'></td><td bgcolor='white' align='right'><a href='?offset=1000'><b>&gt; &gt; &gt;</b></a></td></tr>
<tr><td bgcolor='white' colspan='6'><b>2026-07-17</b></td></tr>
<tr>
<td width='35' bgcolor='white'>10:52<br></td>
<td width='45' bgcolor='white' align='right'><a href='?l=1&a=34&user_id=3365&trip_id=1000946'><img src='yi.html?h7=p3t'></a></td>
<td width='450' bgcolor='white'><a href='?l=1&a=28&user_id=3365'>Jarl Christian Kind</a> &nbsp; - &nbsp; <a href='?l=1&a=43&country_id=112&club_id=343'>Pyongyang Freedom Fighters</a> - <a href='?l=1&a=48&country_id=160'>Norway</a><br>Gin Camino M (white/red)</td>
<td width='35' bgcolor='white' align='right'>02:41</td>
<td width='50' bgcolor='white' align='right'>28.0 km</td>
<td width='100' bgcolor='white'>(SBÅ-Blåfarveverket/Åmot) Første timen var det ikk</td>
</tr>
<tr><td bgcolor='white' colspan='6'><b>2026-07-09</b></td></tr>
<tr>
<td width='35' bgcolor='white'>17:58<br></td>
<td width='45' bgcolor='white' align='right'><a href='?l=1&a=34&user_id=3050&trip_id=998549'><img src='yi.html?h7=e3u'></a></td>
<td width='450' bgcolor='white'><a href='?l=1&a=28&user_id=3050'>Espen Åshammer</a><br>Skywalk Cumeo 2 xxs</td>
<td width='35' bgcolor='white' align='right'>00:41</td>
<td width='50' bgcolor='white' align='right'></td>
<td width='100' bgcolor='white'>DROP-397m</td>
</tr>
<tr><td bgcolor='white'></td><td bgcolor='white' colspan='4'></td><td bgcolor='white' align='right'><a href='?offset=1000'><b>&gt; &gt; &gt;</b></a></td></tr>
</table>
</body></html>`

// The real, verbatim shape for BOTH a genuine zero-flights-this-year takeoff
// (fixtures/a42-119-flights.html) and a nonexistent start_id
// (fixtures/a42-nonexistent-flights.html): identical table shell, identical pagination rows,
// zero 6-cell rows either way. Row emptiness alone cannot tell the two apart — see this
// module's own doc comment for why that distinction is deliberately not made here.
const EMPTY_HTML = `<html><body>
<h3>Flights - </h3>
<table cellspacing='1' cellpadding='2' bgcolor='#22aa00'>
<tr><td bgcolor='white'></td><td bgcolor='white' colspan='4'></td><td bgcolor='white' align='right'><a href='?offset=1000'><b>&gt; &gt; &gt;</b></a></td></tr>
<tr><td bgcolor='white'></td><td bgcolor='white' colspan='4'></td><td bgcolor='white' align='right'><a href='?offset=1000'><b>&gt; &gt; &gt;</b></a></td></tr>
</table>
</body></html>`

const NO_TABLE_HTML = `<html><body><p>homepage fallback content</p></body></html>`

describe('parseTakeoffFlights', () => {
  it('parses every flight row, associating each with its own date group, and drops the pagination/date rows', () => {
    const flights = parseTakeoffFlights(POPULATED_HTML)

    expect(flights).toEqual([
      {
        tripId: 1000946,
        userId: 3365,
        pilotName: 'Jarl Christian Kind',
        club: 'Pyongyang Freedom Fighters',
        glider: 'Gin Camino M (white/red)',
        duration: '02:41',
        distanceKm: 28,
        note: '(SBÅ-Blåfarveverket/Åmot) Første timen var det ikk',
        date: '2026-07-17',
        timeOfDay: '10:52',
      },
      {
        tripId: 998549,
        userId: 3050,
        pilotName: 'Espen Åshammer',
        club: null,
        glider: 'Skywalk Cumeo 2 xxs',
        duration: '00:41',
        distanceKm: null,
        note: 'DROP-397m',
        date: '2026-07-09',
        timeOfDay: '17:58',
      },
    ])
  })

  it('never drops user_id or trip_id: every parsed flight carries both', () => {
    const flights = parseTakeoffFlights(POPULATED_HTML)
    expect(flights.every((flight) => Number.isInteger(flight.userId) && Number.isInteger(flight.tripId))).toBe(true)
  })

  // The failure mode this repo has hit four times: an empty result must mean "genuinely zero
  // flights this year", not "markup this parser silently gave up on". Both the real
  // zero-flights case and the nonexistent-start_id case render this exact shell — this parser
  // alone cannot and must not try to distinguish them; see the module doc comment on why that
  // decision lives in parseTakeoffDetail instead.
  it('returns an empty array, not a throw, for the identical empty shell both a real zero-flight takeoff and a nonexistent start_id render', () => {
    expect(parseTakeoffFlights(EMPTY_HTML)).toEqual([])
  })

  it('throws when the results table is missing entirely, rather than returning an empty list', () => {
    expect(() => parseTakeoffFlights(NO_TABLE_HTML)).toThrow(/not recognised/)
  })
})
