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

// parsePilot's own synthetic fallback shape (see is-fallback-pilot.ts): a present-but-empty
// profile cell. Distinct from a genuine a=28 not-found page, which renders with no profile cell
// at all (see parse-flights.ts's isPilotNotFoundPage / get-pilot-email.ts) — parsePilotEmail
// itself doesn't need to tell the two apart, since neither carries a mailto anchor either way.
const FALLBACK_HTML = `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white"><br><br><br></td><td bgcolor="white"></td></tr></table></div>
</body></html>`

function htmlWithMailtoHref(href: string): string {
  return `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white">Gary Fisher<br>Norway<br><a href="${href}">contact</a><br></td><td bgcolor="white"></td></tr></table></div>
</body></html>`
}

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

  // Pins the scoping itself: an unscoped, document-wide `a[href^="mailto:"]` search would also
  // pass every other case above (neither fixture has a second mailto anchor anywhere else on the
  // page) but would wrongly pick this footer address up here — sending an OTP to a random
  // contact address on the page instead of failing closed to 'no-email'.
  it('ignores a mailto anchor outside the profile cell', () => {
    const html = `<html><body>
<div><table cellpadding="2px" cellspacing="1px" bgcolor="black"><tr><td width="s180" bgcolor="white">Gary Fisher<br>Norway<br><a href="https://flightlog.org/fl.html?l=1&a=26&club_id=16&country_id=160">Lier Hanggliderklubb</a><br>99644983<br></td><td bgcolor="white"></td></tr></table></div>
<div id="footer">Contact us: <a href="mailto:webmaster@flightlog.org">webmaster@flightlog.org</a></div>
</body></html>`
    expect(parsePilotEmail(html)).toBeNull()
  })

  // #176 sends this straight to Resend's `to` field — a raw, unvalidated post-`mailto:` string
  // would let a crafted or malformed href smuggle query params, fan out to multiple recipients,
  // or reach it still percent-encoded.
  it('drops a ?subject= (or any other) query string off the mailto href', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:pilot@example.com?subject=Hello&body=Hi'))).toBe('pilot@example.com')
  })

  it('takes only the first address off a comma-separated mailto list', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:pilot@example.com,other@example.com'))).toBe('pilot@example.com')
  })

  it('decodes a percent-encoded mailto address', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:pilot%2Btag@example.com'))).toBe('pilot+tag@example.com')
  })

  it('treats a mailto href with no @ as no-email rather than surfacing it as found', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:not-an-email'))).toBeNull()
  })

  it('treats a mailto href with malformed percent-encoding as no-email rather than throwing', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:pilot%zzexample.com'))).toBeNull()
  })

  // Re-review finding: splitting on a literal `?`/`,` BEFORE decoding let a percent-encoded
  // delimiter straight through — `%3F` only becomes a real `?` once decoded, so decode has to run
  // first for the query-string strip to actually catch it.
  it('drops a percent-encoded ?subject= off the mailto href, not just a literal one', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:bob@x.com%3Fsubject=Hei'))).toBe('bob@x.com')
  })

  // Same reordering bug, different shape: percent-encoded angle brackets around the address.
  // Closed two ways — decode-then-split no longer treats the encoded brackets as inert address
  // text past a delimiter, and SINGLE_EMAIL_PATTERN itself now rejects `<`/`>` in an address.
  it('treats a mailto href with percent-encoded angle brackets as no-email rather than surfacing them', () => {
    expect(parsePilotEmail(htmlWithMailtoHref('mailto:%3Cbob@x.com%3E'))).toBeNull()
  })
})
