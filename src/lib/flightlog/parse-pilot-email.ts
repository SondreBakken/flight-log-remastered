import * as cheerio from 'cheerio'
import { PROFILE_CELL_SELECTOR } from './parse-flights'

// Same cell parsePilot (parse-flights.ts, which owns PROFILE_CELL_SELECTOR) reads for
// name/country/club — confirmed live against the owner's own fixture (fixtures/pilot-12677.html):
// the info block's last populated line is a `mailto:` anchor sitting alongside the
// name/country/club lines this cell already carries, not a separate table. Selecting by
// `a[href^="mailto:"]` rather than a fixed `<br>`-split line index: a profile with a photo has
// an extra sibling `<td>` for the thumbnail, but that shifts no index INSIDE this cell — still
// safer than assuming the mailto anchor is always the same line position, since phone/glider
// free-text lines (fixtures/pilot-4549.html has none) can shift what comes after it. Scoped to
// PROFILE_CELL_SELECTOR specifically (not a document-wide `a[href^="mailto:"]` search) so a
// mailto anchor anywhere else on the page — a footer contact address, another pilot's link —
// can never be picked up in place of this profile's own (see parse-pilot-email.test.ts's
// "outside the profile cell" case).
const MAILTO_PREFIX = /^mailto:/i

// Simple single-address check, not full RFC 5322 — this repo has no existing email-validation
// helper to reuse, and the exhaustive grammar is unnecessary for what this guards against below.
// Excludes `< > ? ; : " \`` alongside whitespace/`@`/`,` as defense in depth: none of those belong
// in a bare address, and closing them off here means even a decoded string that slipped past the
// `?`/`,` split (see readMailtoAddress's own doc comment) still gets rejected by the pattern.
const SINGLE_EMAIL_PATTERN = /^[^\s@,<>?;:"`]+@[^\s@,<>?;:"`]+\.[^\s@,<>?;:"`]+$/

// A `mailto:` href can carry more than a bare address: `?subject=...` query params, a
// comma-separated list of multiple recipients, and percent-encoding. Any of those passed through
// verbatim would reach an outbound email (Resend's `to` field, via the OTP flow #176 wires up)
// as garbage or as an unintended fan-out. Decodes percent-encoding FIRST, then strips the query
// string and keeps only the first address off a comma-separated list — decoding before splitting
// matters because a percent-encoded `%3F`/`%2C` is a real `?`/`,` once decoded, and splitting on
// the still-encoded string would let it straight through (e.g. `bob@x.com%3Fsubject=Hei` would
// resolve to `bob@x.com?subject=Hei` if split before decode). Finally validates the result
// actually looks like one email address — anything that fails any of those steps is treated the
// same as no mailto anchor at all (returns null), never surfaced as a 'found' email.
function readMailtoAddress(hrefWithoutPrefix: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(hrefWithoutPrefix)
  } catch {
    return null
  }

  const [addressList = ''] = decoded.split('?')
  const [firstAddress = ''] = addressList.split(',')

  const candidate = firstAddress.trim()
  return SINGLE_EMAIL_PATTERN.test(candidate) ? candidate : null
}

// Returns the address, or null when the profile's info block has no `mailto:` anchor at all, or
// when the anchor's own href doesn't survive readMailtoAddress's validation — confirmed live as
// a real, distinct "no email on file" shape (fixtures/pilot-4549.html: name/country/club/phone
// all present, no email line) rather than a hypothetical. Callers combine this with pilot
// existence separately (see get-pilot-email.ts) — a nonexistent pilot's synthetic fallback cell
// (see is-fallback-pilot.ts) has no mailto anchor either, so this alone cannot tell "opted out"
// from "no such pilot" apart.
export function parsePilotEmail(html: string): string | null {
  const $ = cheerio.load(html)
  const profileCell = $(PROFILE_CELL_SELECTOR).first()
  const mailtoHref = profileCell.find('a[href^="mailto:"]').first().attr('href')
  if (mailtoHref === undefined) return null
  return readMailtoAddress(mailtoHref.replace(MAILTO_PREFIX, ''))
}
