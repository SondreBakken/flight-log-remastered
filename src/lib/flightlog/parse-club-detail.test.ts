import { describe, expect, it } from 'vitest'
import { parseClubDetail } from './parse-club-detail'

// Trimmed from the real `a=26&country_id=160&club_id=51` (Voss) shape, with real quirks
// preserved: a club-logo `<img>` inside the Description cell that must not leak into its
// text, a `<br><br>` paragraph break inside Description (Oslo's real fixture has this),
// DMS/UTM/earth.google.com inside Coordinates, and a `0000-00-00 00:00:00` placeholder
// `created` date. The roster table (`bgcolor="black"`) is included even though this file
// never reads it — parseClubDetail's own floor check requires it to be present, the same way
// a real a=26 response always carries both blocks together.
function clubHtml({
  clubName = 'Voss Hang- Og Paragliderklubb',
  members = '1271',
  rows = ["<tr><td bgcolor='white'>Description</td><td bgcolor='white'><a href='/x'><img src='/y' alt='club logo'></a>Lokalisert på Voss<br>\n<br>\nSecond paragraph.</td></tr>",
    "<tr><td bgcolor='white'>Members</td><td bgcolor='white'>MEMBERS</td></tr>",
    "<tr><td bgcolor='white'>Coordinates</td><td bgcolor='white'>DMS: N 60&deg; 38' 25''<br>UTM: 32V 363342<br><a href='https://earth.google.com/web/search/60.6,6.5' target='_blank'>earth.google.com</a></td></tr>",
    "<tr><td bgcolor='white'>created</td><td bgcolor='white'>0000-00-00 00:00:00 </td></tr>",
    "<tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2026-02-14 13:52:15 Martin Krossoy</td></tr>"],
}: { clubName?: string; members?: string; rows?: string[] } = {}): string {
  const infoRows = rows.map((row) => row.replace('MEMBERS', members)).join('\n')
  return `<html><body>
<span style='font-style:italic;'><a href='/x'>Home</a></span> -> <span style='font-style:italic;'><a href='/x'>Pilots/Clubs</a></span> -> <span style='font-style:italic;'><a href='/x'>Norway</a></span> -> <span style='font-style:italic;'>${clubName}</span>
<div align='left'><table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td bgcolor='white'>Link to more info</td><td bgcolor='white'><a href='https://www.vosshpk.no'>https://www.vosshpk.no</a></td></tr>
${infoRows}
</table>
<table><tr><td><h4>Club members</h4><table cellspacing='1' cellpadding='3' bgcolor='black'>
<tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=1>Pilot One</a></td></tr>
</table></td></tr></table>
</div>
</body></html>`
}

describe('parseClubDetail', () => {
  it('reads name from the breadcrumb, member count, description (multi-line, image stripped), coordinates, map link and dates', () => {
    const detail = parseClubDetail(clubHtml(), 51)

    expect(detail).toEqual({
      clubId: 51,
      name: 'Voss Hang- Og Paragliderklubb',
      memberCount: 1271,
      coordinatesText: "DMS: N 60° 38' 25''\nUTM: 32V 363342\nearth.google.com",
      mapUrl: 'https://earth.google.com/web/search/60.6,6.5',
      description: 'Lokalisert på Voss\nSecond paragraph.',
      linkUrl: 'https://www.vosshpk.no',
      createdAt: null,
      updatedAt: '2026-02-14 13:52:15 Martin Krossoy',
    })
  })

  it('reads a genuine zero-member club as memberCount 0, not a throw', () => {
    const detail = parseClubDetail(clubHtml({ members: '0' }), 37)
    expect(detail?.memberCount).toBe(0)
  })

  it('returns null for the 0-byte-body not-found signal — never renders it as an empty club', () => {
    expect(parseClubDetail('', 999999999)).toBeNull()
  })

  it('treats "Link to more info" and "Coordinates" as optional — a club without either still parses', () => {
    const html = `<html><body>
<span style='font-style:italic;'>Home</span> -> <span style='font-style:italic;'>Pilots/Clubs</span> -> <span style='font-style:italic;'>Norway</span> -> <span style='font-style:italic;'>Oslo Paragliderklubb</span>
<table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td>Description</td><td>Oslo club</td></tr>
<tr><td>Members</td><td>677</td></tr>
<tr><td>created</td><td>0000-00-00 00:00:00 </td></tr>
<tr><td>Updated</td><td>2026-01-01 00:00:00 Someone</td></tr>
</table>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

    const detail = parseClubDetail(html, 33)
    expect(detail).toMatchObject({ memberCount: 677, linkUrl: null, coordinatesText: null, mapUrl: null })
  })

  it('throws when the info table is missing entirely, rather than returning a half-built club', () => {
    expect(() => parseClubDetail('<html><body><div>flightlog.org</div></body></html>', 999)).toThrow()
  })

  it('throws when a required label (Members) is missing — unrecognised markup, not an empty club', () => {
    const html = `<html><body>
<span style='font-style:italic;'>Home</span> -> <span style='font-style:italic;'>Pilots/Clubs</span> -> <span style='font-style:italic;'>Norway</span> -> <span style='font-style:italic;'>Some Club</span>
<table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td>Description</td><td>x</td></tr>
<tr><td>created</td><td>0000-00-00 00:00:00 </td></tr>
<tr><td>Updated</td><td>2026-01-01 00:00:00 x</td></tr>
</table>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

    expect(() => parseClubDetail(html, 999)).toThrow()
  })
})
