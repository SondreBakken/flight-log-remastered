import { describe, expect, it } from 'vitest'
import { parseTrack } from './parse-track'
import type { ScoringGeometry, ScoringGeometryResult, TrackStats, TrackStatsResult } from './types'

// Narrows a scoring result down to a real, parsed geometry, failing the test with a clear
// assertion message if it's actually `null` or `'unparseable'` — used wherever a test needs
// to read fields (turnpointIndices, distanceKm, ...) that only exist on the real shape.
function assertGeometry(state: ScoringGeometryResult): asserts state is ScoringGeometry {
  expect(state).not.toBeNull()
  expect(state).not.toBe('unparseable')
}

// Same narrowing for TrackStatsResult (see its own doc comment in types.ts) — used wherever a
// test needs to read a field (date, maxAltitude, ...) that only exists on the real shape.
function assertStats(result: TrackStatsResult): asserts result is TrackStats {
  expect(result).not.toBe('unparseable')
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

// The current GpsDumpAndroid label wording, one entry per table line — kept as named lines
// rather than one block string so individual tests can override exactly one line (see
// buildStatsBlock) without hand-copying the other seven.
const NEWER_STATS_LINES = {
  header: 'Flight statistics',
  date: 'Date                 2020-01-01',
  startFinish: 'Start/finish         00:00:00 - 00:00:40',
  duration: 'Duration             0 : 00 : 40',
  height: 'Height (max/min)     804 / 800 m',
  maxSpeed: 'Max. speed (10s/60s) 10 / 10 km/h',
  maxClimb: 'Max. climb (10s/60s) 0.1 / 0.1 m/s',
  minClimb: 'Min. climb (10s/60s) -0.1 / -0.1 m/s',
} as const

function buildStatsBlock(overrides: Partial<Record<keyof typeof NEWER_STATS_LINES, string>> = {}): string {
  const lines = { ...NEWER_STATS_LINES, ...overrides }
  return [
    lines.header,
    lines.date,
    lines.startFinish,
    lines.duration,
    lines.height,
    lines.maxSpeed,
    lines.maxClimb,
    lines.minClimb,
  ].join('\n')
}

const NEWER_STATS_BLOCK = buildStatsBlock()

function kmlDocument(
  placemarks: string,
  options: { statsBlock?: string; pilotComment?: string } = {},
): string {
  const statsBlock = options.statsBlock ?? NEWER_STATS_BLOCK
  const pilotComment = options.pilotComment ?? ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document>
<open>1</open>
  <Folder>
    <Metadata src="Test" v="1" type="trip"/>
    <open>1</open>
    <name>Trip</name>
    <description><![CDATA[
${pilotComment}<pre>
${statsBlock}
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
    assertStats(track.stats)
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

// #59's fix round: these run in CI on every clean checkout (hand-built KML, no fixture read),
// unlike scripts/check-parsers.mts's older-GpsDump-fixture assertions, which only run when
// fixtures/ happens to be present locally. That script's own assertions against the real
// track-233524.kml/track-235690.kml fixtures are the cross-check for this same behaviour.
describe('parseTrack stats block', () => {
  const ALL_STAT_FIELDS: Array<keyof TrackStats> = [
    'date',
    'startFinish',
    'duration',
    'maxAltitude',
    'minAltitude',
    'maxSpeed',
    'maxClimb',
    'minClimb',
  ]

  // Every known label individually replaced with unrecognised wording, one test per label —
  // each must null out only its own field(s), leaving the rest (including the block's own
  // parseable-vs-unparseable verdict) untouched.
  const LABEL_VARIANT_CASES: Array<{
    label: string
    override: Partial<Record<keyof typeof NEWER_STATS_LINES, string>>
    nulledFields: Array<keyof TrackStats>
  }> = [
    { label: 'Date', override: { date: 'Unrecognised         2020-01-01' }, nulledFields: ['date'] },
    {
      label: 'Start/finish',
      override: { startFinish: 'Unrecognised         00:00:00 - 00:00:40' },
      nulledFields: ['startFinish'],
    },
    { label: 'Duration', override: { duration: 'Unrecognised         0 : 00 : 40' }, nulledFields: ['duration'] },
    {
      label: 'Height (max/min)',
      override: { height: 'Unrecognised         804 / 800 m' },
      nulledFields: ['maxAltitude', 'minAltitude'],
    },
    {
      label: 'Max. speed (10s/60s)',
      override: { maxSpeed: 'Unrecognised         10 / 10 km/h' },
      nulledFields: ['maxSpeed'],
    },
    {
      label: 'Max. climb (10s/60s)',
      override: { maxClimb: 'Unrecognised         0.1 / 0.1 m/s' },
      nulledFields: ['maxClimb'],
    },
    {
      label: 'Min. climb (10s/60s)',
      override: { minClimb: 'Unrecognised         -0.1 / -0.1 m/s' },
      nulledFields: ['minClimb'],
    },
  ]

  it.each(LABEL_VARIANT_CASES)(
    'removing just the "$label" label nulls only its own field(s), leaving every other field recognised',
    ({ override, nulledFields }) => {
      const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: buildStatsBlock(override) }), 1)
      assertStats(track.stats)
      for (const field of ALL_STAT_FIELDS) {
        if (nulledFields.includes(field)) expect(track.stats[field]).toBeNull()
        else expect(track.stats[field]).not.toBeNull()
      }
    },
  )

  it('collapses to unparseable only when every known label fails to match, not when some — including the metadata fields — still do', () => {
    const fullyUnrecognised = buildStatsBlock({
      date: 'Unrecognised A        2020-01-01',
      startFinish: 'Unrecognised B        00:00:00 - 00:00:40',
      duration: 'Unrecognised C        0 : 00 : 40',
      height: 'Unrecognised D        804 / 800 m',
      maxSpeed: 'Unrecognised E        10 / 10 km/h',
      maxClimb: 'Unrecognised F        0.1 / 0.1 m/s',
      minClimb: 'Unrecognised G        -0.1 / -0.1 m/s',
    })
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: fullyUnrecognised }), 1)

    expect(track.stats).toBe('unparseable')
    expect(track.points.length).toBeGreaterThan(0)
  })

  // The regression this fix round exists to close: date/start-finish/duration are matched by
  // the same mechanism as the five performance fields and are equally strong evidence the
  // block's wording was recognised — a future exporter that renames only the performance labels
  // must not have its already-correctly-parsed date/start-finish/duration thrown away.
  it('keeps date/start-finish/duration when every performance label is unrecognised, instead of discarding them as unparseable', () => {
    const onlyPerformanceRenamed = buildStatsBlock({
      height: 'Unrecognised height  804 / 800 m',
      maxSpeed: 'Unrecognised speed   10 / 10 km/h',
      maxClimb: 'Unrecognised climb   0.1 / 0.1 m/s',
      minClimb: 'Unrecognised climb2  -0.1 / -0.1 m/s',
    })
    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: onlyPerformanceRenamed }), 1)

    assertStats(track.stats)
    expect(track.stats.date).toBe('2020-01-01')
    expect(track.stats.startFinish).toBe('00:00:00 - 00:00:40')
    expect(track.stats.duration).toBe('0 : 00 : 40')
    expect(track.stats.maxAltitude).toBeNull()
    expect(track.stats.maxSpeed).toBeNull()
    expect(track.stats.maxClimb).toBeNull()
    expect(track.stats.minClimb).toBeNull()
  })

  it('returns unparseable when the description has no <pre> table at all, the same signal as unrecognised wording', () => {
    const kml = kmlDocument(FIVE_POINT_PLACEMARK).replace(/<pre>[\s\S]*?<\/pre>/, '')

    const track = parseTrack(kml, 1)

    expect(track.stats).toBe('unparseable')
  })

  it('recognizes the older 2010-era GpsDump label wording (Max./min. height, Max. mean/top speed, the combined Max/min climb rate line)', () => {
    const olderEraStatsBlock = [
      'Flight statistics',
      'Date                 2020-01-01',
      'Start/finish         00:00:00 - 00:00:40',
      'Duration             0 : 00 : 40',
      'Max./min. height     804 / 800 m',
      'Max. mean/top speed  10 / 10 km/h',
      'Max/min climb rate   2.25 / -2.68 m/s over 60s',
    ].join('\n')

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: olderEraStatsBlock }), 1)

    assertStats(track.stats)
    expect(track.stats.maxAltitude).toBe(804)
    expect(track.stats.minAltitude).toBe(800)
    expect(track.stats.maxSpeed).toBe('10 / 10 km/h')
    expect(track.stats.maxClimb).toBe('2.25 m/s over 60s')
    expect(track.stats.minClimb).toBe('-2.68 m/s over 60s')
  })

  it('a blank value column resolves to null, not the next line\'s label read across the newline as this field\'s value', () => {
    const blankSpeedColumn = buildStatsBlock({ maxSpeed: 'Max. speed (10s/60s)' })

    const track = parseTrack(kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: blankSpeedColumn }), 1)

    assertStats(track.stats)
    expect(track.stats.maxSpeed).toBeNull()
    // The sibling field on the very next line is untouched by the blank value above it.
    expect(track.stats.maxClimb).toBe('0.1 / 0.1 m/s')
  })

  describe('the pilot\'s free-text comment cannot fabricate or override a statistic', () => {
    it('a fake "Date" line ahead of the table does not override the real one inside <pre>', () => {
      const kml = kmlDocument(FIVE_POINT_PLACEMARK, {
        pilotComment: 'solberg med alf og kurt og litespeed s\nDate  not-a-date-at-all\n',
      })

      const track = parseTrack(kml, 1)

      assertStats(track.stats)
      expect(track.stats.date).toBe('2020-01-01')
    })

    it('an injected label ahead of the table cannot manufacture a stat inside an otherwise-unrecognised block', () => {
      const fullyUnrecognised = buildStatsBlock({
        date: 'Unrecognised A        2020-01-01',
        startFinish: 'Unrecognised B        00:00:00 - 00:00:40',
        duration: 'Unrecognised C        0 : 00 : 40',
        height: 'Unrecognised D        804 / 800 m',
        maxSpeed: 'Unrecognised E        10 / 10 km/h',
        maxClimb: 'Unrecognised F        0.1 / 0.1 m/s',
        minClimb: 'Unrecognised G        -0.1 / -0.1 m/s',
      })
      const kml = kmlDocument(FIVE_POINT_PLACEMARK, {
        statsBlock: fullyUnrecognised,
        pilotComment: 'Max. speed (10s/60s) hello there\n',
      })

      const track = parseTrack(kml, 1)

      expect(track.stats).toBe('unparseable')
    })
  })
})

describe('parseClimbRates (combined "Max/min climb rate" line, older GpsDump format)', () => {
  function olderEraStatsBlock(climbLine: string): string {
    return [
      'Flight statistics',
      'Date                 2020-01-01',
      'Start/finish         00:00:00 - 00:00:40',
      'Duration             0 : 00 : 40',
      'Max./min. height     804 / 800 m',
      'Max. mean/top speed  10 / 10 km/h',
      climbLine,
    ].join('\n')
  }

  it('splits a real climb line with its interval suffix into maxClimb/minClimb, suffix intact', () => {
    const track = parseTrack(
      kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: olderEraStatsBlock('Max/min climb rate   2.25 / -2.68 m/s over 60s') }),
      1,
    )

    assertStats(track.stats)
    expect(track.stats.maxClimb).toBe('2.25 m/s over 60s')
    expect(track.stats.minClimb).toBe('-2.68 m/s over 60s')
  })

  it('a suffix-less climb line keeps the number intact instead of the mandatory-suffix group truncating it', () => {
    const track = parseTrack(
      kmlDocument(FIVE_POINT_PLACEMARK, { statsBlock: olderEraStatsBlock('Max/min climb rate   2.25 / -2.68') }),
      1,
    )

    assertStats(track.stats)
    expect(track.stats.maxClimb).toBe('2.25')
    expect(track.stats.minClimb).toBe('-2.68')
  })

  it('a leading-plus max value is recognised, not silently dropped as unmatched', () => {
    const track = parseTrack(
      kmlDocument(FIVE_POINT_PLACEMARK, {
        statsBlock: olderEraStatsBlock('Max/min climb rate   +2.25 / -2.68 m/s over 60s'),
      }),
      1,
    )

    assertStats(track.stats)
    expect(track.stats.maxClimb).toBe('+2.25 m/s over 60s')
    expect(track.stats.minClimb).toBe('-2.68 m/s over 60s')
  })

  // Documented out of scope (see parseClimbRates' own comment): no sampled fixture uses
  // decimal-comma values, so this pins the current, intentional null rather than silently
  // leaving it unverified.
  it('decimal-comma values are out of scope and resolve to null rather than a wrong number', () => {
    const track = parseTrack(
      kmlDocument(FIVE_POINT_PLACEMARK, {
        statsBlock: olderEraStatsBlock('Max/min climb rate   2,25 / -2,68 m/s over 60s'),
      }),
      1,
    )

    assertStats(track.stats)
    expect(track.stats.maxClimb).toBeNull()
    expect(track.stats.minClimb).toBeNull()
  })
})
