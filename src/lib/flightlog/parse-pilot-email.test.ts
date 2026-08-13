import { describe, expect, it } from 'vitest'
import { parsePilotEmail } from './parse-pilot-email'

// Trimmed from the real `a=28&user_id=12677` response (fixtures/pilot-12677.html, the owner's
// own account): the info cell packs name, country, club link, mailto anchor and phone together
// on `<br>`-separated lines, alongside a sibling `<td>` for the profile photo — the extra `<td>`
// is why this parser selects by `a[href^="mailto:"]` rather than a fixed line index.
const WITH_PHOTO_AND_EMAIL_HTML = `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white">Sondre Bakken<br>Norway<br><a href="https://flightlog.org/fl.html?l=1&a=26&club_id=51&country_id=160">Voss Hang- Og Paragliderklubb</a><br><a href="mailto:sondrebakken@gmail.com">sondrebakken@gmail.com</a><br/>+4790252264<br></td><td bgcolor="white"><a href='/fl.html?rqtid=3&user_id=12677'><img src='/fl.html?rqtid=3&user_id=12677&thumb' alt='user photo'></a></td></tr></table></div>
</body></html>`

// Trimmed from the real `a=28&user_id=4549` response (fixtures/pilot-4549.html): same cell
// shape, no photo `<td>`, no mailto anchor at all — confirmed live as a genuine "no email on
// file" profile, not a hypothetical case.
const NO_EMAIL_HTML = `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white">Gary Fisher<br>Norway<br><a href="https://flightlog.org/fl.html?l=1&a=26&club_id=16&country_id=160">Lier Hanggliderklubb</a><br>99644983<br>falcon 4<br/>Ls rx3</td><td bgcolor="white"><a href='/fl.html?rqtid=3&user_id=4549'><img src='/fl.html?rqtid=3&user_id=4549&thumb' alt='user photo'></a></td></tr></table></div>
</body></html>`

// A nonexistent pilot id (see is-fallback-pilot.ts's doc comment): a=28 has no dedicated
// not-found signal, so a bogus id renders the identical page shape with every field empty,
// including this cell's own lines.
const FALLBACK_HTML = `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white"><br><br><br></td><td bgcolor="white"></td></tr></table></div>
</body></html>`

describe('parsePilotEmail', () => {
  it('reads the address out of the mailto anchor, stripping the mailto: prefix', () => {
    expect(parsePilotEmail(WITH_PHOTO_AND_EMAIL_HTML)).toBe('sondrebakken@gmail.com')
  })

  it('returns null when the info cell has no mailto anchor at all — a real, distinct "no email on file" profile', () => {
    expect(parsePilotEmail(NO_EMAIL_HTML)).toBeNull()
  })

  it('returns null for the empty-fields fallback shape a nonexistent pilot id renders', () => {
    expect(parsePilotEmail(FALLBACK_HTML)).toBeNull()
  })

  it('returns null for markup with no matching cell at all, rather than throwing', () => {
    expect(parsePilotEmail('<html><body><p>unrelated page</p></body></html>')).toBeNull()
  })
})
