import { describe, expect, it } from 'vitest'
import { parseClubRoster } from './parse-club-roster'

const ROSTER_HTML = `<html><body>
<div>
<!-- Phantom "pilot details" icon anchors, real markup from a26-51-club.html (Voss): these
     carry a user_id and no name, but live OUTSIDE the roster table entirely. A parser that
     searched the whole document for a[href*="user_id="] instead of scoping to the roster
     table would miscount the roster by picking these up as blank-name rows. -->
<a href="https://flightlog.org/fl.html?l=1&amp;a=28&amp;user_id=9000&amp;xc=xc"><img src="yi.html" alt="pilot details"></a>
</div>
<table cellspacing='1' cellpadding='3' bgcolor='black'>
<tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=1>Ada Sofie Thrane Bjoroy</a></td></tr>
<tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=2>Cato Wiese-Hansen</a></td></tr>
<tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=3>Cato Wiese-Hansen</a></td></tr>
<tr><td bgcolor='white'><a href='/fl.html?a=28&user_id=999' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a></td></tr>
</table>
</body></html>`

const EMPTY_ROSTER_HTML = `<html><body>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

describe('parseClubRoster', () => {
  it('reads user id and name for each roster row, excludes an in-table honeypot, and never fuses two members sharing a name into one', () => {
    const roster = parseClubRoster(ROSTER_HTML, 51)

    expect(roster).toEqual([
      { userId: 1, name: 'Ada Sofie Thrane Bjoroy' },
      { userId: 2, name: 'Cato Wiese-Hansen' },
      { userId: 3, name: 'Cato Wiese-Hansen' },
    ])
  })

  it('never scoops up a user_id-bearing anchor from outside the roster table (e.g. the "pilot details" icon link)', () => {
    const roster = parseClubRoster(ROSTER_HTML, 51)
    expect(roster.some((member) => member.userId === 9000)).toBe(false)
  })

  it('returns an empty list — not a throw — for a real club with a present-but-empty roster table', () => {
    expect(parseClubRoster(EMPTY_ROSTER_HTML, 37)).toEqual([])
  })

  it('throws rather than returning an empty list when the roster table is missing entirely', () => {
    expect(() => parseClubRoster('<html><body><div>flightlog.org</div></body></html>', 999)).toThrow()
  })

  it('throws rather than silently dropping a row when a member anchor uses an unexpected action code', () => {
    const wrongActionHtml = `<html><body><table cellspacing='1' cellpadding='3' bgcolor='black'>
    <tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=99&user_id=1>Someone</a></td></tr>
    </table></body></html>`

    expect(() => parseClubRoster(wrongActionHtml, 51)).toThrow()
  })

  it('dedupes an exact repeated user_id, but keeps two distinct ids that share a name', () => {
    const dupeHtml = `<html><body><table cellspacing='1' cellpadding='3' bgcolor='black'>
    <tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=1>Ada Sofie Thrane Bjoroy</a></td></tr>
    <tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=1>Ada Sofie Thrane Bjoroy</a></td></tr>
    </table></body></html>`

    expect(parseClubRoster(dupeHtml, 51)).toEqual([{ userId: 1, name: 'Ada Sofie Thrane Bjoroy' }])
  })
})
