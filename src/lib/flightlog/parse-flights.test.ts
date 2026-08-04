import { describe, expect, it } from 'vitest'
import { parseFlights } from './parse-flights'

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
