import { describe, expect, it } from 'vitest'
import { parseClubDetail } from './parse-club-detail'

// Trimmed from the real `a=26&country_id=160&club_id=51` (Voss) shape, with real quirks
// preserved: a club-logo `<img>` inside the Description cell that must not leak into its
// text, a `<br><br>` paragraph break inside Description (Oslo's real fixture has this),
// DMS/UTM/earth.google.com inside Coordinates, and a `0000-00-00 00:00:00` placeholder
// `created` date. The roster table (`bgcolor="black"`) is included for realism (a real a=26
// response always carries both blocks together) even though this parser no longer requires
// its presence — that used to be checked here on the theory that its absence would catch a
// clubs-LIST page fed by mistake, but the selector is shared with parse-clubs.ts's own
// clubs-list results table, so it never actually distinguished the two (see
// parseClubDetail's own doc comment); the info-table check three lines above is what does
// that job. `selfLinkClubId`, when given, adds one of the page's own repeated
// `a=26&club_id=<id>` self-links (the language switcher, in real markup) — omitted by default
// so the identity gate this backs stays a no-op for every test that isn't specifically about it.
function clubHtml({
  clubName = 'Voss Hang- Og Paragliderklubb',
  members = '1271',
  selfLinkClubId,
  rows = ["<tr><td bgcolor='white'>Description</td><td bgcolor='white'><a href='/x'><img src='/y' alt='club logo'></a>Lokalisert på Voss<br>\n<br>\nSecond paragraph.</td></tr>",
    "<tr><td bgcolor='white'>Members</td><td bgcolor='white'>MEMBERS</td></tr>",
    "<tr><td bgcolor='white'>Coordinates</td><td bgcolor='white'>DMS: N 60&deg; 38' 25''<br>UTM: 32V 363342<br><a href='https://earth.google.com/web/search/60.6,6.5' target='_blank'>earth.google.com</a></td></tr>",
    "<tr><td bgcolor='white'>created</td><td bgcolor='white'>0000-00-00 00:00:00 </td></tr>",
    "<tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2026-02-14 13:52:15 Martin Krossoy</td></tr>"],
}: { clubName?: string; members?: string; selfLinkClubId?: number; rows?: string[] } = {}): string {
  const infoRows = rows.map((row) => row.replace('MEMBERS', members)).join('\n')
  const selfLink =
    selfLinkClubId === undefined
      ? ''
      : `<span><a href='https://flightlog.org/fl.html?l=2&a=26&country_id=160&club_id=${selfLinkClubId}'>norwegian</a></span>`
  return `<html><body>
${selfLink}
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
      coordinatesText: "DMS: N 60° 38' 25''\nUTM: 32V 363342",
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

  // it.each over every REQUIRED_LABELS entry, not just Members — before this, only Members had
  // a negative test, so dropping any of Description/created/Updated from the parser's own
  // REQUIRED_LABELS list would have survived every existing test undetected.
  it.each(['Description', 'Members', 'created', 'Updated'])(
    'throws when the required label %s is missing — unrecognised markup, not a partial club',
    (missingLabel) => {
      const allRows = [
        "<tr><td>Description</td><td>x</td></tr>",
        "<tr><td>Members</td><td>677</td></tr>",
        "<tr><td>created</td><td>0000-00-00 00:00:00 </td></tr>",
        "<tr><td>Updated</td><td>2026-01-01 00:00:00 x</td></tr>",
      ]
      const rows = allRows.filter((row) => !row.includes(`>${missingLabel}<`))
      const html = `<html><body>
<span style='font-style:italic;'>Home</span> -> <span style='font-style:italic;'>Pilots/Clubs</span> -> <span style='font-style:italic;'>Norway</span> -> <span style='font-style:italic;'>Some Club</span>
<table cellspacing='1' cellpadding='3' bgcolor='#778899'>
${rows.join('\n')}
</table>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

      // Matches the specific "missing expected field(s) [<label>]" message, not just any
      // throw — this file's other fields are read unconditionally further down (e.g.
      // `description: readMultilineText(rows.get('Description')!)`), so a missing row for one
      // of them can throw for an unrelated reason (a `.html()` call on `undefined`) even if
      // REQUIRED_LABELS itself no longer names it; asserting the message is what actually pins
      // REQUIRED_LABELS rather than "the parser throws for any reason at all".
      expect(() => parseClubDetail(html, 999)).toThrow(new RegExp(`missing expected field\\(s\\).*${missingLabel}`))
    },
  )

  it('excludes a honeypot anchor from the Coordinates cell, choosing the real map link', () => {
    const html = clubHtml({
      rows: [
        "<tr><td bgcolor='white'>Description</td><td bgcolor='white'>x</td></tr>",
        "<tr><td bgcolor='white'>Members</td><td bgcolor='white'>MEMBERS</td></tr>",
        "<tr><td bgcolor='white'>Coordinates</td><td bgcolor='white'><a href='/trap' class='hp-nav' rel='nofollow' data-trap='1'>trap</a>DMS: N 60&deg;<br><a href='https://earth.google.com/web/search/60.6,6.5'>earth.google.com</a></td></tr>",
        "<tr><td bgcolor='white'>created</td><td bgcolor='white'>0000-00-00 00:00:00 </td></tr>",
        "<tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2026-01-01 00:00:00 x</td></tr>",
      ],
    })

    expect(parseClubDetail(html, 51)?.mapUrl).toBe('https://earth.google.com/web/search/60.6,6.5')
  })

  it('excludes a honeypot anchor from the "Link to more info" cell', () => {
    const html = `<html><body>
<span style='font-style:italic;'>Home</span> -> <span style='font-style:italic;'>Pilots/Clubs</span> -> <span style='font-style:italic;'>Norway</span> -> <span style='font-style:italic;'>Some Club</span>
<table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td>Link to more info</td><td><a href='/trap' class='hp-nav' rel='nofollow' data-trap='1'>trap</a><a href='https://real-club-site.example'>real-club-site.example</a></td></tr>
<tr><td>Description</td><td>x</td></tr>
<tr><td>Members</td><td>677</td></tr>
<tr><td>created</td><td>0000-00-00 00:00:00 </td></tr>
<tr><td>Updated</td><td>2026-01-01 00:00:00 x</td></tr>
</table>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

    expect(parseClubDetail(html, 999)?.linkUrl).toBe('https://real-club-site.example')
  })

  // Guards the `.first()` in findAnchor: with two non-honeypot anchors in the same cell, the
  // FIRST one is the real link (matching the repo's convention everywhere else an anchor is
  // picked out of a cell/row) — swapping to `.last()` must change this test's outcome.
  it('picks the first anchor when a cell carries more than one non-honeypot link', () => {
    const html = `<html><body>
<span style='font-style:italic;'>Home</span> -> <span style='font-style:italic;'>Pilots/Clubs</span> -> <span style='font-style:italic;'>Norway</span> -> <span style='font-style:italic;'>Some Club</span>
<table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td>Link to more info</td><td><a href='https://first.example'>first</a><a href='https://second.example'>second</a></td></tr>
<tr><td>Description</td><td>x</td></tr>
<tr><td>Members</td><td>677</td></tr>
<tr><td>created</td><td>0000-00-00 00:00:00 </td></tr>
<tr><td>Updated</td><td>2026-01-01 00:00:00 x</td></tr>
</table>
<table cellspacing='1' cellpadding='3' bgcolor='black'></table>
</body></html>`

    expect(parseClubDetail(html, 999)?.linkUrl).toBe('https://first.example')
  })

  it('parses normally when the page\'s own repeated club_id self-links agree with the requested clubId', () => {
    const detail = parseClubDetail(clubHtml({ selfLinkClubId: 51 }), 51)
    expect(detail?.clubId).toBe(51)
  })

  // The identity gate: a response markup-compatible with a DIFFERENT club than the one
  // requested must not silently have the requested clubId stamped onto it — see #7's fix round
  // and parseTakeoffFlights' own identity gate for a=42.
  it('throws when the page\'s own club_id self-links disagree with the requested clubId', () => {
    expect(() => parseClubDetail(clubHtml({ selfLinkClubId: 33 }), 51)).toThrow(/identifies itself as club 33/)
  })
})
