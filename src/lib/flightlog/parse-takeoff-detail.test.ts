import { describe, expect, it } from 'vitest'
import { parseTakeoffDetail } from './parse-takeoff-detail'

// Trimmed from the real `a=22&country_id=160&start_id=179` response (fixtures/a22-179-detail.html),
// real quirks preserved: the description cell's leading wind-compass image and start-photo
// thumbnail before any text, `<br>` as the only paragraph separator, the malformed stray `</a>`
// after the weather link (real markup, not a transcription error — same family of defect
// parse-clubs.ts already documents), and a genuine `Siterecord` row with all three classes.
const BREADCRUMB = (name: string | null) =>
  `<span style='font-style:italic;'><a href='https://flightlog.org/fl.html?l=1'>Home</a></span> <span style='font-family:Courier'>-></span> <span style='font-style:italic;'><a href='https://flightlog.org/fl.html?l=1&a=2'>Takeoffs</a></span> <span style='font-family:Courier'>-></span> <span style='font-style:italic;'><a href='https://flightlog.org/fl.html?l=1&a=21&country_id=160'>Norway</a></span>${
    name === null ? '' : ` <span style='font-family:Courier'>-></span> <span style='font-style:italic;'>${name}</span>`
  }`

const POPULATED_HTML = `<html><body>
<table><tr><td>${BREADCRUMB('Drammen, Solbergåsen')}</td></tr></table>
<div style='padding:0px 10px'>
<div align='left'><table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'>region</td><td bgcolor='white'>Buskerud</td></tr><tr><td bgcolor='white'>Altitude</td><td bgcolor='white'>401 meters asl Top to bottom 398 meters</td></tr><tr><td bgcolor='white'>Link to more info</td><td bgcolor='white'><a href='http://goo.gl/maps/eiVlQ'>http://goo.gl/maps/eiVlQ</a></td></tr><tr><td bgcolor='white' colspan='2'><a href='https://holfuy.com/en/map/wind'>Map with Holfuy weather stations in the area</a></td></tr><tr><td bgcolor='white'>Description</td><td bgcolor='white'><img src='/fl.html?rqtid=17' alt=' E SE' align='right'><a href='/fl.html?rqtid=3'><img src='/fl.html?rqtid=3' alt='photo of start'></a><br/>Pilottrinn PP3/SP3<br />Veibeskrivelse:<br />Følg stien.<br /></td></tr><tr><td bgcolor='white'>Coordinates</td><td bgcolor='white'>DMS: N 59&deg; 46' 8''<br>UTM: 32V</td></tr><tr><td bgcolor='white'>weather</td><td bgcolor='white'><a href='http://ready.arl.noaa.gov/x'>http://ready.arl.noaa.gov/x<a/></td></tr><tr><td bgcolor='white'>Siterecord</td><td bgcolor='white'>PG: <a href='https://flightlog.org/fl.html?l=1&a=34&trip_id=803981'>Mikael Benjamin Ulstrup, 196.9 Km</a>&nbsp;&nbsp;HG: <a href='https://flightlog.org/fl.html?l=1&a=34&trip_id=594778'>Frederic Bakken, 37.4 Km</a>&nbsp;&nbsp;HG2: <a href='https://flightlog.org/fl.html?l=1&a=34&trip_id=167461'>Werner Johannessen, 5.5 Km</a>&nbsp;&nbsp;</td></tr><tr><td bgcolor='white'>created</td><td bgcolor='white'>0000-00-00 00:00:00 </td></tr><tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2023-04-09 18:21:29 Espen Åshammer</td></tr></table>
</div>
</div></body></html>`

// A minimal-but-real takeoff (fixtures/a22-119-detail.html's shape): no "Link to more info",
// no Holfuy row, an empty Siterecord cell, and a real (non-placeholder) created date.
const MINIMAL_HTML = `<html><body>
<table><tr><td>${BREADCRUMB('Hafstadfjellet')}</td></tr></table>
<div align='left'><table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'>region</td><td bgcolor='white'>Sogn og Fjordane</td></tr><tr><td bgcolor='white'>Altitude</td><td bgcolor='white'>0 meters asl </td></tr><tr><td bgcolor='white'>Description</td><td bgcolor='white'><br/>ikke logg her</td></tr><tr><td bgcolor='white'>Siterecord</td><td bgcolor='white'></td></tr><tr><td bgcolor='white'>created</td><td bgcolor='white'>2001-02-23 10:47:50 </td></tr><tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2006-02-15 20:01:25 Sindre Hauglum</td></tr></table></div>
</body></html>`

// The real, verbatim shape of a nonexistent `start_id` (fixtures/a22-nonexistent-detail.html):
// same table, same required labels, but no fourth breadcrumb span and every value blank.
const NONEXISTENT_HTML = `<html><body>
<table><tr><td>${BREADCRUMB(null)}</td></tr></table>
<div align='left'><table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'>Altitude</td><td bgcolor='white'> meters asl </td></tr><tr><td bgcolor='white'>Description</td><td bgcolor='white'><br/></td></tr><tr><td bgcolor='white'>Siterecord</td><td bgcolor='white'></td></tr><tr><td bgcolor='white'>created</td><td bgcolor='white'> </td></tr><tr><td bgcolor='white'>Updated</td><td bgcolor='white'> </td></tr></table></div>
</body></html>`

// a=23's generic "Takeoffs per country" index shares the identical results-table selector
// (cellspacing='1' cellpadding='3' bgcolor='black') but none of REQUIRED_LABELS — this app
// never fetches a=23, but the parser must still fail loudly if it were ever handed this shape
// rather than silently returning an empty-ish detail object.
const WRONG_PAGE_HTML = `<html><body>
<table><tr><td>${BREADCRUMB(null)}</td></tr></table>
<table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&a=21&country_id=2'>Albania</a></td><td bgcolor='white'>11</td></tr></table>
</body></html>`

const NO_TABLE_HTML = `<html><body><p>homepage fallback content</p></body></html>`

describe('parseTakeoffDetail', () => {
  it('parses a fully populated takeoff, including all three site record classes', () => {
    const detail = parseTakeoffDetail(POPULATED_HTML, 179)

    expect(detail).toEqual({
      takeoffId: 179,
      name: 'Drammen, Solbergåsen',
      region: 'Buskerud',
      altitude: '401 meters asl Top to bottom 398 meters',
      description: 'Pilottrinn PP3/SP3\nVeibeskrivelse:\nFølg stien.',
      linkUrl: 'http://goo.gl/maps/eiVlQ',
      createdAt: null,
      updatedAt: '2023-04-09 18:21:29 Espen Åshammer',
      siteRecords: [
        { recordClass: 'PG', pilotName: 'Mikael Benjamin Ulstrup', distanceKm: 196.9, tripId: 803981 },
        { recordClass: 'HG', pilotName: 'Frederic Bakken', distanceKm: 37.4, tripId: 594778 },
        { recordClass: 'HG2', pilotName: 'Werner Johannessen', distanceKm: 5.5, tripId: 167461 },
      ],
    })
  })

  it('parses a minimal real takeoff: no link, no site records, a real (non-placeholder) created date', () => {
    const detail = parseTakeoffDetail(MINIMAL_HTML, 119)

    expect(detail).toEqual({
      takeoffId: 119,
      name: 'Hafstadfjellet',
      region: 'Sogn og Fjordane',
      altitude: '0 meters asl',
      description: 'ikke logg her',
      linkUrl: null,
      createdAt: '2001-02-23 10:47:50',
      updatedAt: '2006-02-15 20:01:25 Sindre Hauglum',
      siteRecords: [],
    })
  })

  it('normalises the 0000-00-00 00:00:00 created placeholder to null, not a fake date', () => {
    const detail = parseTakeoffDetail(POPULATED_HTML, 179)
    expect(detail?.createdAt).toBeNull()
  })

  // The regression this app has hit four times: a parser returning an empty/falsy result for
  // markup it does not recognise, instead of throwing. A nonexistent start_id renders the
  // exact same table shell as a real takeoff (all REQUIRED_LABELS present) — only the
  // breadcrumb's own name is missing — so this must return null, not throw and not silently
  // fabricate a blank-but-present TakeoffDetail.
  it('returns null (not an error, not an empty-but-present object) for a nonexistent start_id', () => {
    expect(parseTakeoffDetail(NONEXISTENT_HTML, 999999999)).toBeNull()
  })

  it('throws for a=23-shaped markup sharing the same table selector but none of the expected field labels', () => {
    expect(() => parseTakeoffDetail(WRONG_PAGE_HTML, 179)).toThrow(/not recognised/)
  })

  it('throws when the results table is missing entirely', () => {
    expect(() => parseTakeoffDetail(NO_TABLE_HTML, 179)).toThrow(/not recognised/)
  })
})
