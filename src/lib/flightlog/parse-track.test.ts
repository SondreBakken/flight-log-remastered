import { describe, expect, it } from 'vitest'
import { parseTrack } from './parse-track'
import type { ScoringGeometry, ScoringGeometryResult } from './types'

// Narrows a scoring result down to a real, parsed geometry, failing the test with a clear
// assertion message if it's actually `null` or `'unparseable'` — used wherever a test needs
// to read fields (turnpointIndices, distanceKm, ...) that only exist on the real shape.
function assertGeometry(state: ScoringGeometryResult): asserts state is ScoringGeometry {
  expect(state).not.toBeNull()
  expect(state).not.toBe('unparseable')
}

// A small, hand-built tracklog rather than a full real fixture (thousands of points):
// structurally identical to the real shape confirmed against fixtures/track-*.kml (Metadata/
// @type, FsInfo/@track_idx, a fixed-width CDATA table, LineString coordinates) — see
// scripts/check-scoring.mts for the same assertions run against the real, gitignored
// fixtures this repo actually ships against.
const TRACKLOG_PLACEMARK = `
    <Placemark>
      <Metadata src="Test" v="1" type="track">
        <FsInfo time_of_first_point="2020-01-01T00:00:00Z" instrument="test" downloaded="2020-01-01T00:00:00Z" hash="x">
          <SecondsFromTimeOfFirstPoint>0 10 20 30 40</SecondsFromTimeOfFirstPoint>
        </FsInfo>
      </Metadata>
      <name>Tracklog</name>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>
          9.000000,61.000000,800 9.001000,61.000100,801 9.002000,61.000200,802 9.003000,61.000300,803 9.004000,61.000400,804
        </coordinates>
      </LineString>
    </Placemark>`

function kmlDocument(placemarks: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document>
<open>1</open>
  <Folder>
    <Metadata src="Test" v="1" type="trip"/>
    <open>1</open>
    <name>Trip</name>
    <description><![CDATA[
<pre>
Flight statistics
Date                 2020-01-01
Start/finish         00:00:00 - 00:00:40
Duration             0 : 00 : 40
Height (max/min)     804 / 800 m
Max. speed (10s/60s) 10 / 10 km/h
Max. climb (10s/60s) 0.1 / 0.1 m/s
Min. climb (10s/60s) -0.1 / -0.1 m/s
</pre>]]>
    </description>${placemarks}
${TRACKLOG_PLACEMARK}
  </Folder>
</Document>`
}

const FIVE_POINT_PLACEMARK = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_5_point">
        <FsInfo track_idx="0 1 2 3 4" />
      </Metadata>
      <name>Distance over 5 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 5 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
 B     2  00:00:10  N 61  00  00.36  E 009  00  03.60  0.04
 C     3  00:00:20  N 61  00  00.72  E 009  00  07.20  0.04
 D     4  00:00:30  N 61  00  01.08  E 009  00  10.80  0.04
 E     5  00:00:40  N 61  00  01.44  E 009  00  14.40  0.04
                                                  Sum  0.16
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.001000,61.000100,801
          9.002000,61.000200,802
          9.003000,61.000300,803
          9.004000,61.000400,804
        </coordinates>
      </LineString>
      <Style>
        <LineStyle>
          <color>FFFF0000</color>
        </LineStyle>
      </Style>
    </Placemark>`

describe('parseTrack scoring geometries', () => {
  it('parses a real scoring placemark with exact turnpoint indices and its own summed distance', () => {
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK), 1)

    expect(track.scoring.distance_5_point).toEqual({
      kind: 'distance_5_point',
      name: 'Distance over 5 points',
      distanceKm: 0.16,
      turnpointIndices: [0, 1, 2, 3, 4],
    })
    // Turnpoint indices resolve directly into this same Track's points array (#14's shared
    // hover identity), not a separate coordinate list — no proximity matching involved.
    const fivePoint = track.scoring.distance_5_point
    assertGeometry(fivePoint)
    const turnpoints = fivePoint.turnpointIndices.map((i) => track.points[i])
    expect(turnpoints[0]).toEqual({ lon: 9.0, lat: 61.0, altitude: 800, secondsFromStart: 0 })
    expect(turnpoints[4]).toEqual({ lon: 9.004, lat: 61.0004, altitude: 804, secondsFromStart: 40 })
  })

  it('a scoring placemark absent entirely (not in the KML at all) resolves to null, not a throw', () => {
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK), 1)

    expect(track.scoring.distance_4_point).toBeNull()
    expect(track.scoring.distance_3_point).toBeNull()
    expect(track.scoring.distance_open).toBeNull()
    expect(track.scoring.distance_out_and_return).toBeNull()
  })

  it('a metadata-only stub placemark (no description, no LineString — the real shape a triangle placemark has) resolves to null', () => {
    const stub = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_4_point">
        <FsInfo track_idx="0 1 2 3" />
      </Metadata>
      <name>Distance over 4 points</name>
      <Style>
        <LineStyle>
          <color>FFFF0000</color>
        </LineStyle>
      </Style>
    </Placemark>`
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + stub), 1)

    expect(track.scoring.distance_4_point).toBeNull()
  })

  it('a degenerate geometry (every turnpoint index resolves to the same point) resolves to null, never a zero-length line', () => {
    const degenerate = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_3_point">
        <FsInfo track_idx="0 0 0" />
      </Metadata>
      <name>Distance over 3 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 3 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
 B     1  00:00:00  N 61  00  00.00  E 009  00  00.00  0.00
 C     1  00:00:00  N 61  00  00.00  E 009  00  00.00  0.00
                                                  Sum  0.00
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.000000,61.000000,800
          9.000000,61.000000,800
        </coordinates>
      </LineString>
      <Style>
        <LineStyle>
          <color>FFFF0000</color>
        </LineStyle>
      </Style>
    </Placemark>`
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + degenerate), 1)

    expect(track.scoring.distance_3_point).toBeNull()
  })

  // Before this branch, every case below made parseTrack itself throw — and parseTrack has no
  // error boundary below it (see src/app/flights/[tripId]/page.tsx), so a malformed OPTIONAL
  // overlay used to delete the map, altitude gradient, barogram and stats along with it. Now
  // it's contained to `'unparseable'` on that one geometry: loud (parseScoringGeometry still
  // throws internally, logged via console.error — see resolveScoringGeometry), but the rest
  // of the track parses normally, and 'unparseable' stays distinguishable from a genuinely
  // absent geometry (`null`) rather than collapsing into it.

  it('a description present without a LineString is unparseable, not a thrown error that deletes the whole track', () => {
    const malformed = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_4_point">
        <FsInfo track_idx="0 1 2 3" />
      </Metadata>
      <name>Distance over 4 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 4 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
                                                  Sum  0.16
</pre>]]>
      </description>
    </Placemark>`

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + malformed), 1)
    expect(track.scoring.distance_4_point).toBe('unparseable')
    expect(track.points.length).toBeGreaterThan(0)
    expect(track.stats.date).toBe('2020-01-01')
  })

  it('a LineString present without a description is unparseable, not a thrown error that deletes the whole track', () => {
    const malformed = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_4_point">
        <FsInfo track_idx="0 1 2 3" />
      </Metadata>
      <name>Distance over 4 points</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.001000,61.000100,801
          9.002000,61.000200,802
          9.003000,61.000300,803
        </coordinates>
      </LineString>
    </Placemark>`

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + malformed), 1)
    expect(track.scoring.distance_4_point).toBe('unparseable')
    expect(track.points.length).toBeGreaterThan(0)
  })

  it('a turnpoint index count that disagrees with its own LineString coordinate count is unparseable, not a thrown error', () => {
    const mismatched = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_4_point">
        <FsInfo track_idx="0 1 2 3 4" />
      </Metadata>
      <name>Distance over 4 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 4 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
                                                  Sum  0.16
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.001000,61.000100,801
          9.002000,61.000200,802
          9.003000,61.000300,803
        </coordinates>
      </LineString>
    </Placemark>`

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + mismatched), 1)
    expect(track.scoring.distance_4_point).toBe('unparseable')
  })

  it('a turnpoint index outside the track is unparseable, not a thrown error that drops it silently either', () => {
    const outOfBounds = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_4_point">
        <FsInfo track_idx="0 1 2 99" />
      </Metadata>
      <name>Distance over 4 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 4 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
                                                  Sum  0.16
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.001000,61.000100,801
          9.002000,61.000200,802
          9.003000,61.000300,803
        </coordinates>
      </LineString>
    </Placemark>`

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + outOfBounds), 1)
    expect(track.scoring.distance_4_point).toBe('unparseable')
  })

  it('a fractional track_idx ("0 1.5 4") is unparseable, not a raw TypeError from indexing points[] with a non-integer', () => {
    const fractional = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_3_point">
        <FsInfo track_idx="0 1.5 4" />
      </Metadata>
      <name>Distance over 3 points</name>
      <description>
        <![CDATA[
<pre>
Greatest distance using 3 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  00  00.00  E 009  00  00.00
                                                  Sum  0.16
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.001000,61.000100,801
          9.004000,61.000400,804
        </coordinates>
      </LineString>
    </Placemark>`

    expect(() => parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + fractional), 1)).not.toThrow()
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK + fractional), 1)
    expect(track.scoring.distance_3_point).toBe('unparseable')
  })

  it('a track placemark itself being unusable still throws — only the scoring parse changed blast radius', () => {
    const noTrackCoordinates = kmlDocument('').replace(
      /<coordinates>[\s\S]*?<\/coordinates>/,
      '<coordinates></coordinates>',
    )
    expect(() => parseTrack(noTrackCoordinates, 1)).toThrow()
  })

  it('distance_open (no Sum row) reads its fixed-width Distance column, not the trailing DMS seconds a Distance-less row also ends in', () => {
    // Row A's own Longitude DMS seconds ("48.05") looks exactly like a trailing decimal
    // number too — this pins that the column-position read (not a naive "last number on the
    // line" scan) is what tells the two apart. See parseOpenDistanceKm's own comment.
    const openDistance = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_open">
        <FsInfo track_idx="0 4" />
      </Metadata>
      <name>Open distance</name>
      <description>
        <![CDATA[
<pre>
Greatest distance between any 2 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  42  25.77  E 009  27  48.05
 B     5  00:00:40  N 61  39  23.39  E 009  37  53.75  10.55
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.004000,61.000400,804
        </coordinates>
      </LineString>
      <Style>
        <LineStyle>
          <color>FF0000FF</color>
        </LineStyle>
      </Style>
    </Placemark>`
    const track = parseTrack(kmlDocument(openDistance), 1)
    const geometry = track.scoring.distance_open
    assertGeometry(geometry)
    expect(geometry.distanceKm).toBe(10.55)
  })

  it('distance_open whose LAST data row itself has no distance printed is unparseable, not the row\'s own trailing DMS seconds read as a distance', () => {
    // The one shape the fixture above never exercises: parseOpenDistanceKm always reads the
    // LAST row, and until now every fixture's last row happened to carry a real distance. Row
    // B here is that last row, and — like row A above — its own Longitude DMS seconds
    // ("53.75") looks exactly like a trailing decimal number too. A naive "last decimal number
    // on the last data row" scan would read 53.75 as the distance; the fixed-width column read
    // must find nothing at the Distance column position instead.
    const openDistanceNoTrailingDistance = `
    <Placemark>
      <Metadata src="Test" v="1" type="distance_open">
        <FsInfo track_idx="0 4" />
      </Metadata>
      <name>Open distance</name>
      <description>
        <![CDATA[
<pre>
Greatest distance between any 2 points

Pos.      Time      Latitude         Longitude         Distance
 A     1  00:00:00  N 61  42  25.77  E 009  27  48.05
 B     5  00:00:40  N 61  39  23.39  E 009  37  53.75
</pre>]]>
      </description>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          9.000000,61.000000,800
          9.004000,61.000400,804
        </coordinates>
      </LineString>
      <Style>
        <LineStyle>
          <color>FF0000FF</color>
        </LineStyle>
      </Style>
    </Placemark>`
    const track = parseTrack(kmlDocument(openDistanceNoTrailingDistance), 1)

    expect(track.scoring.distance_open).toBe('unparseable')
  })
})
