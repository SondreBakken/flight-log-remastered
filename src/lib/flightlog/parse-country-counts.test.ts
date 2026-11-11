import { describe, expect, it } from 'vitest'
import { parseCountryCounts } from './parse-country-counts'

const NORWAY = 160
const SWEDEN = 203
const BOUVET = 29

// Shape taken from the owner's 2026-11-11 description of a=3; no saved real fixture exists.
const SAMPLE = `<html><body>
<b>No of registered users per country:</b><br>
<a href='?l=1&a=48&country_id=160'>Norway</a> (1293)<br>
<a href='?l=1&a=48&country_id=203'>Sweden</a> (800)<br>
<a href='?l=1&a=48&country_id=29'>Bouvet Island</a> (3)<br>
<a class='hp-nav' rel='nofollow' data-trap='1' href='?l=1&a=48&country_id=999'>Trap</a> (77)<br>
<b>No of clubs per country:</b><br>
<a href='?l=1&a=25&country_id=160'>Norway</a> (12)<br>
<a href='?l=1&a=25&country_id=203'>Sweden</a> (5)<br>
<a rel='nofollow' href='?l=1&a=25&country_id=998'>Trap</a> (9)<br>
</body></html>`

describe('parseCountryCounts', () => {
  it('reads both lists, keeping each anchor in its own map and skipping honeypot anchors', () => {
    const counts = parseCountryCounts(SAMPLE)

    expect(counts.pilots).toEqual(new Map([[NORWAY, 1293], [SWEDEN, 800], [BOUVET, 3]]))
    expect(counts.clubs).toEqual(new Map([[NORWAY, 12], [SWEDEN, 5]]))
  })

  it('leaves a pilots-only country out of the clubs map', () => {
    expect(parseCountryCounts(SAMPLE).clubs.has(BOUVET)).toBe(false)
  })

  it('skips an entry with a non-digit count instead of reading it as 0', () => {
    const html = `<b>No of clubs per country:</b><br>
<a href='?a=25&country_id=160'>Norway</a> (many)<br>
<a href='?a=25&country_id=203'>Sweden</a> (5)<br>`

    expect(parseCountryCounts(html).clubs).toEqual(new Map([[SWEDEN, 5]]))
  })

  it('keeps the first count when an id repeats', () => {
    const html = `<b>No of clubs per country:</b><br>
<a href='?a=25&country_id=160'>Norway</a> (12)<br>
<a href='?a=25&country_id=160'>Norway</a> (99)<br>`

    expect(parseCountryCounts(html).clubs).toEqual(new Map([[NORWAY, 12]]))
  })

  it('returns two empty maps for markup with neither list', () => {
    const counts = parseCountryCounts('<html><body><p>nothing</p></body></html>')

    expect(counts.pilots.size).toBe(0)
    expect(counts.clubs.size).toBe(0)
  })
})
