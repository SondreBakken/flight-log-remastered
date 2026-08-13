import { describe, expect, it } from 'vitest'
import { parseFlights, hasProfileCell, isPilotNotFoundPage } from './parse-flights'

// Trimmed from a real row in fixtures/pilot-4549.html (trip 1001428): the date cell packs the
// date text, a country link (a=47) and a takeoff link (a=42) together, told apart by action
// code — see parse-flights.ts's own doc comment. `takeoffLinkHtml` is substituted per test so
// each case only varies the one thing it's proving.
function flightRowHtml(takeoffLinkHtml: string): string {
  return `<html><body><table><tr>
    <td><a href='?l=1&a=34&user_id=4549&trip_id=1001428'>view</a></td>
    <td>
      2026-07-20 12:53<br>
      <a href='?l=1&a=47&country_id=160'>Norway</a> : &nbsp; ${takeoffLinkHtml}
    </td>
    <td>RX3</td>
    <td>01:56</td>
    <td>52.0 km</td>
    <td>48.8 km</td>
    <td>Bøst :)</td>
  </tr></table></body></html>`
}

describe('parseFlights — takeoffRef (#76)', () => {
  it('reads countryId/takeoffId from the takeoff link\'s own country_id/start_id query params, matching the takeoffs dataset\'s join key', () => {
    const html = flightRowHtml("<a href='?l=1&a=42&country_id=160&start_id=15'>Bismo (Riksanlegget)</a>")

    const [flight] = parseFlights(html, 4549)

    expect(flight?.takeoff).toBe('Bismo (Riksanlegget)')
    expect(flight?.takeoffRef).toEqual({ countryId: 160, takeoffId: 15 })
  })

  it('parses the ref for a foreign (non-curated-country) takeoff too, alongside the display name — filtering by curation is the join\'s job, not the parser\'s', () => {
    const html = flightRowHtml("<a href='?l=1&a=42&country_id=73&start_id=558'>Laragne, Chabre</a>")

    const [flight] = parseFlights(html, 4549)

    expect(flight?.takeoff).toBe('Laragne, Chabre')
    expect(flight?.takeoffRef).toEqual({ countryId: 73, takeoffId: 558 })
  })

  it('yields null when the date cell has no takeoff link at all, not a partial ref', () => {
    const html = flightRowHtml('')

    const [flight] = parseFlights(html, 4549)

    expect(flight?.takeoff).toBeNull()
    expect(flight?.takeoffRef).toBeNull()
  })

  it('yields null for a malformed href missing start_id, even though the link itself resolves a display name', () => {
    const html = flightRowHtml("<a href='?l=1&a=42&country_id=160'>Somewhere</a>")

    const [flight] = parseFlights(html, 4549)

    expect(flight?.takeoff).toBe('Somewhere')
    expect(flight?.takeoffRef).toBeNull()
  })

  it('yields null for a malformed href missing country_id', () => {
    const html = flightRowHtml("<a href='?l=1&a=42&start_id=15'>Somewhere</a>")

    const [flight] = parseFlights(html, 4549)

    expect(flight?.takeoff).toBe('Somewhere')
    expect(flight?.takeoffRef).toBeNull()
  })
})

// See fixtures/pilot-nonexistent.html (a real captured a=28 not-found page, and
// check-parsers.mts's own assertions against it) for these two functions' actual live proof —
// these synthetic cases exist so CI on a clean checkout (fixtures/ is gitignored) still exercises
// the two shapes get-pilot-email.ts's three-way branch depends on.
describe('hasProfileCell / isPilotNotFoundPage (#173 follow-up)', () => {
  const PROFILE_HTML = `<html><body><table><tr><td width="s180">Sondre Bakken<br>Norway<br></td></tr></table></body></html>`
  // Trimmed to the one signal that matters: a=28's real not-found page renders no profile cell
  // at all, plus this exact bare `not found` div — see parse-flights.ts's own doc comment for
  // why this, and not a present-but-empty cell, is what a genuinely unallocated pilot id renders.
  const NOT_FOUND_HTML = `<html><body><div style='padding:0px 10px'>not found</div></body></html>`
  const UNRECOGNISED_HTML = `<html><body><p>some other page entirely, no profile cell and no not-found marker</p></body></html>`
  // Unlike NOT_FOUND_HTML/UNRECOGNISED_HTML above, this one actually contains `<div>` elements —
  // shaped like a WAF/Cloudflare interstitial, the exact real-world drift isPilotNotFoundPage
  // exists to not misclassify as "not found". Without a `<div>`-bearing negative case, a mutant
  // that replaces the predicate's whole body with `.some(() => true)` still passes every assertion
  // below (both other fixtures have zero `<div>` elements, so `$('div').toArray().some(...)`
  // returns false regardless of the callback) — see #173's re-review.
  const DIV_BEARING_UNRECOGNISED_HTML = `<html><body><div class="cf-wrapper"><div id="challenge">Checking your browser</div></div></body></html>`

  it('hasProfileCell is true when the profile cell is present', () => {
    expect(hasProfileCell(PROFILE_HTML)).toBe(true)
  })

  it('hasProfileCell is false for the not-found page and for genuinely unrecognised markup alike', () => {
    expect(hasProfileCell(NOT_FOUND_HTML)).toBe(false)
    expect(hasProfileCell(UNRECOGNISED_HTML)).toBe(false)
  })

  it('isPilotNotFoundPage is true only for the genuine not-found marker', () => {
    expect(isPilotNotFoundPage(NOT_FOUND_HTML)).toBe(true)
    expect(isPilotNotFoundPage(PROFILE_HTML)).toBe(false)
    expect(isPilotNotFoundPage(UNRECOGNISED_HTML)).toBe(false)
  })

  it('isPilotNotFoundPage is false for div-bearing markup whose divs never contain the exact "not found" text', () => {
    expect(isPilotNotFoundPage(DIV_BEARING_UNRECOGNISED_HTML)).toBe(false)
  })
})
