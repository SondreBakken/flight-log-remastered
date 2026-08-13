import * as cheerio from 'cheerio'

// Same cell parsePilot (parse-flights.ts) reads for name/country/club — confirmed live against
// the owner's own fixture (fixtures/pilot-12677.html): the info block's last populated line is
// a `mailto:` anchor sitting alongside the name/country/club lines this cell already carries,
// not a separate table. Selecting by `a[href^="mailto:"]` rather than a fixed `<br>`-split line
// index: a profile with a photo has an extra sibling `<td>` for the thumbnail, but that shifts
// no index INSIDE this cell — still safer than assuming the mailto anchor is always the same
// line position, since phone/glider free-text lines (fixtures/pilot-4549.html has none) can
// shift what comes after it.
const PROFILE_CELL_SELECTOR = 'td[width="s180"]'
const MAILTO_PREFIX = /^mailto:/i

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Returns the address, or null when the profile's info block has no `mailto:` anchor at all —
// confirmed live as a real, distinct shape (fixtures/pilot-4549.html: name/country/club/phone
// all present, no email line) rather than a hypothetical. Callers combine this with pilot
// existence separately (see get-pilot-email.ts) — a nonexistent pilot's synthetic fallback cell
// (see is-fallback-pilot.ts) has no mailto anchor either, so this alone cannot tell "opted out"
// from "no such pilot" apart.
export function parsePilotEmail(html: string): string | null {
  const $ = cheerio.load(html)
  const profileCell = $(PROFILE_CELL_SELECTOR).first()
  const mailtoHref = profileCell.find('a[href^="mailto:"]').first().attr('href')
  return textOrNull((mailtoHref ?? '').replace(MAILTO_PREFIX, ''))
}
