import { describe, expect, it } from 'vitest'
import { parseClubStats } from './parse-club-stats'

// Trimmed from the real `rqtid=1&club_id=51` shape: header wrapped in its own `<tr>` (unlike
// rqtid=9/10/11's unwrapped `<th>` row), a zero-distance row, and a fixed-decimal distance
// with no thousands separator.
const STATS_HTML = `<html><body><table border=1><tr><th>Name</th><th>Flights</th><th>Distance (km)</th><th>Time (hours)</th></tr>
<tr><td>Ade Hawkins</td><td>14</td><td>0.0000</td><td>1.1667</td></tr>
<tr><td>Andreas Mosling</td><td>47</td><td>242.4000</td><td>22.5167</td></tr>
</table></body></html>`

// Byte-identical shape to a nonexistent club_id's response — this parser cannot and does not
// try to distinguish them (see docs/flightlog-api.md's "THE JOIN"); that distinction is made
// by cross-referencing a=26 at the fetcher level, not here.
const EMPTY_STATS_HTML = `<html><body><table border=1><tr><th>Name</th><th>Flights</th><th>Distance (km)</th><th>Time (hours)</th></tr></table></body></html>`

describe('parseClubStats', () => {
  it('reads name, flights, distance and hours for each row', () => {
    expect(parseClubStats(STATS_HTML, 51)).toEqual([
      { name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1667 },
      { name: 'Andreas Mosling', flights: 47, distanceKm: 242.4, hours: 22.5167 },
    ])
  })

  it('returns an empty list — not a throw — for the header-only empty shape', () => {
    expect(parseClubStats(EMPTY_STATS_HTML, 37)).toEqual([])
  })

  it('throws when the header field order does not match (a different rqtid response sharing the same bare-table shape)', () => {
    const wrongHeaderHtml = `<html><body><table border=1><tr><th>id</th><th>name</th></tr></table></body></html>`
    expect(() => parseClubStats(wrongHeaderHtml, 51)).toThrow()
  })

  it('throws rather than silently dropping a row with a non-numeric flights cell', () => {
    const badRowHtml = `<html><body><table border=1><tr><th>Name</th><th>Flights</th><th>Distance (km)</th><th>Time (hours)</th></tr>
    <tr><td>Someone</td><td>not-a-number</td><td>0.0000</td><td>0.0000</td></tr>
    </table></body></html>`

    expect(() => parseClubStats(badRowHtml, 51)).toThrow()
  })
})
