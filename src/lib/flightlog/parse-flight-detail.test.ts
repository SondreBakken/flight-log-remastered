import { describe, expect, it } from 'vitest'
import { parseFlightDetail } from './parse-flight-detail'

// Trimmed from the real `a=34&trip_id=803981` response (fixtures/a34-803981-detail.html): a
// TRACKED flight — carries the `View trip` row, the malformed (no opening `<tr>`, real markup,
// not a transcription error) `Open distance`/`Best distance over 5 points` scoring rows
// flightlog.org interleaves between `Description` and `Takeoff type` for a flight with a GPS
// track, and the auto-generated `Flight statistics` `<pre>` block appended to the pilot's own
// free-text description.
const POPULATED_HTML = `<html><body>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='5' bgcolor='black'>
<tr><td bgcolor='white'>Date</td><td bgcolor='white'>2022-07-29 11:36</td></tr>
<tr><td bgcolor='white'>Country</td><td bgcolor='white'>Norway</td></tr>
<tr><td bgcolor='white'>Takeoff</td><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=179'>Drammen, Solbergåsen</a></td></tr>
<tr><td bgcolor='white'>Glider brand and model</td><td bgcolor='white'>Advance Omega XAlps 4   </td></tr>
<tr><td bgcolor='white'>Duration</td><td bgcolor='white'>06:38</td></tr>
<tr><td bgcolor='white'>Distance (km)</td><td bgcolor='white'>212.0 km</td></tr>
<tr><td bgcolor='white'>Max altitude</td><td bgcolor='white'>2608 meters above sea-level</td></tr>
<tr><td bgcolor='white'>Description</td><td bgcolor='white'>Hokksund A og B åpnet til standard høyder av Roy.<br />
<br />
Ny pers! Fantastisk tur. Fløy hele turen sammen med Arne Kristian.
      <br/>
      2022-07-29<br/>
<pre>
Flight statistics
Date                 2022-07-29
Duration             6 : 38 : 10
Max./min. height     2608 / 194 m
Total distance       308.80 km
</pre>
      </td></tr>
         <tr>
         <td bgcolor='white'>View trip</td>
         <td bgcolor='white'><a href='/fl.html?rqtid=20&trip_id=803981&20220729173838'>View flight in Google Map</a><br>
         <a href='https://www.paralogg.se/map/0F803981'>PARALOGG.SE - paragliding tracklog analysis</a></td>
         </tr>
      <td bgcolor='white'>Open distance</td><td bgcolor='white'>Start: N 59&deg; 45&#039; 43&#039;&#039;<br>Finish: N 61&deg; 31&#039; 56&#039;&#039;<br>Distance: 196.9km</tr>
      <tr><td bgcolor='white' colspan='2'>Best distance over 5 points</td></tr><tr><td bgcolor='white'>Distance</td><td bgcolor='white'>212 km</td></tr>
        <tr>
        <td bgcolor='white'>Takeoff type</td>
        <td bgcolor='white'>mountain</td>
        </tr>
      <tr><td bgcolor='white'></td><td bgcolor='white'></td></tr>
      </table>
</div>
</body></html>`

// Trimmed from the real `a=34&trip_id=1001964` response (fixtures/a34-1001964-detail.html): an
// UNTRACKED flight (the app's own pilot account, per #215's own background) — no `View trip`
// row, no scoring rows, no `Flight statistics` block, and blank (not absent) `Distance (km)`/
// `Max altitude` values. This is the exact shape /flights/[tripId] actually calls this parser
// against, since it only ever runs for a trip `hasTrack` already reported false for.
const MINIMAL_HTML = `<html><body>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='5' bgcolor='black'>
<tr><td bgcolor='white'>Date</td><td bgcolor='white'>2026-07-21</td></tr>
<tr><td bgcolor='white'>Country</td><td bgcolor='white'>Norway</td></tr>
<tr><td bgcolor='white'>Takeoff</td><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=133'>Voss, Hjelle/Gjelle</a></td></tr>
<tr><td bgcolor='white'>Glider brand and model</td><td bgcolor='white'>Skywalk Mescal 6   </td></tr>
<tr><td bgcolor='white'>Duration</td><td bgcolor='white'>00:06</td></tr>
<tr><td bgcolor='white'>Distance (km)</td><td bgcolor='white'>
      </td></tr>
<tr><td bgcolor='white'>Max altitude</td><td bgcolor='white'>
      </td></tr>
<tr><td bgcolor='white'>Description</td><td bgcolor='white'>Min første høydetur
      <br/>
      </td></tr>
        <tr>
        <td bgcolor='white'>Takeoff type</td>
        <td bgcolor='white'>mountain</td>
        </tr>
      <tr><td bgcolor='white'></td><td bgcolor='white'></td></tr>
      </table>
</div>
</body></html>`

// The real, verbatim shape of a nonexistent `trip_id` (fixtures/a34-nonexistent-detail.html):
// the identical content container, but the literal text `not found` in place of any results
// table at all — not an empty/header-only table the way a=22's own nonexistent-id shape is.
const NOT_FOUND_HTML = `<html><body>
<div style='padding:0px 10px'>
not found
</div>
</body></html>`

// No `div[style='padding:0px 10px']` at all — this parser's own content-container signal never
// matches, so it must throw rather than mistake this for a "not found" response (which DOES
// have that container, just no table inside it).
const NO_CONTAINER_HTML = `<html><body><p>homepage fallback content</p></body></html>`

// A synthetic page sharing a=34's exact table selector (cellspacing='1' cellpadding='5'
// bgcolor='black') but none of its field labels — not a confirmed-live page (unlike
// NOT_FOUND_HTML), included the same way parse-takeoff-detail.test.ts's own WRONG_PAGE_HTML is:
// proof the parser throws rather than silently returning a near-empty FlightDetail when handed
// unrecognised markup that happens to reuse the same table shape.
const WRONG_LABELS_HTML = `<html><body>
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='5' bgcolor='black'>
<tr><td bgcolor='white'>Some other field</td><td bgcolor='white'>value</td></tr>
</table>
</div>
</body></html>`

describe('parseFlightDetail', () => {
  it('parses a fully populated (tracked) flight, ignoring the interleaved scoring rows', () => {
    const detail = parseFlightDetail(POPULATED_HTML, 803981)

    expect(detail).toMatchObject({
      tripId: 803981,
      date: '2022-07-29 11:36',
      country: 'Norway',
      takeoff: 'Drammen, Solbergåsen',
      takeoffRef: { countryId: 160, takeoffId: 179 },
      glider: 'Advance Omega XAlps 4',
      duration: '06:38',
      distanceKm: 212,
      maxAltitude: '2608 meters above sea-level',
      takeoffType: 'mountain',
    })
    expect(detail?.description).toContain('Hokksund A og B åpnet til standard høyder av Roy.')
    expect(detail?.description).toContain('Ny pers! Fantastisk tur. Fløy hele turen sammen med Arne Kristian.')
  })

  it('parses an untracked flight: blank Distance/Max altitude values resolve to null, not zero or an empty string', () => {
    const detail = parseFlightDetail(MINIMAL_HTML, 1001964)

    expect(detail).toEqual({
      tripId: 1001964,
      date: '2026-07-21',
      country: 'Norway',
      takeoff: 'Voss, Hjelle/Gjelle',
      takeoffRef: { countryId: 160, takeoffId: 133 },
      glider: 'Skywalk Mescal 6',
      duration: '00:06',
      distanceKm: null,
      maxAltitude: null,
      description: 'Min første høydetur',
      takeoffType: 'mountain',
    })
  })

  // The regression this app's other parsers have already hit repeatedly (see
  // parse-takeoff-detail.ts's own doc comment): a nonexistent trip_id must return null, not
  // throw and not silently fabricate a blank-but-present FlightDetail.
  it('returns null (not an error, not an empty-but-present object) for a nonexistent trip_id', () => {
    expect(parseFlightDetail(NOT_FOUND_HTML, 999999999)).toBeNull()
  })

  it('throws when the content container itself is missing', () => {
    expect(() => parseFlightDetail(NO_CONTAINER_HTML, 1)).toThrow(/no content container/)
  })

  it('throws for markup sharing the same table selector but none of the expected field labels', () => {
    expect(() => parseFlightDetail(WRONG_LABELS_HTML, 1)).toThrow(/missing expected field/)
  })

  it.each(['Date', 'Country', 'Takeoff', 'Glider brand and model', 'Duration', 'Distance (km)', 'Max altitude', 'Description'])(
    'throws when the required label %s is missing, even though every other label is present',
    (label) => {
      const html = MINIMAL_HTML.replace(new RegExp(`<tr><td bgcolor='white'>${label.replace(/[()]/g, '\\$&')}</td>.*?</tr>\\n`, 's'), '')
      expect(() => parseFlightDetail(html, 1001964)).toThrow(/missing expected field/)
    },
  )

  it('resolves takeoffRef to null when the Takeoff cell carries no anchor, without throwing', () => {
    const html = MINIMAL_HTML.replace(
      "<a href='https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=133'>Voss, Hjelle/Gjelle</a>",
      'Voss, Hjelle/Gjelle',
    )
    const detail = parseFlightDetail(html, 1001964)
    expect(detail?.takeoff).toBe('Voss, Hjelle/Gjelle')
    expect(detail?.takeoffRef).toBeNull()
  })

  it('resolves Takeoff type to null when the row is absent, rather than throwing', () => {
    const html = MINIMAL_HTML.replace(/<tr>\s*<td bgcolor='white'>Takeoff type<\/td>\s*<td bgcolor='white'>mountain<\/td>\s*<\/tr>/, '')
    const detail = parseFlightDetail(html, 1001964)
    expect(detail?.takeoffType).toBeNull()
  })
})
