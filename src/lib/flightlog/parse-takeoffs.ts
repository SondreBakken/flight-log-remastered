import { extractDataRows, type Nodes } from './parse-flightlog-table'
import type { Takeoff } from './types'

// Confirmed field order for rqtid=11 (Norway, country_id=160 — 6012 rows, and Bouvet Island,
// country_id=29 — 0 rows, both header-only-verified). Also doubles as the positive signal
// that distinguishes this response from rqtid=8 (the full 24-field takeoff schema doc, never
// fetched in production) and from rqtid=10/regions (8 fields) — both share the identical bare
// `<table border=1>` shape but a different header.
const TAKEOFF_HEADER = [
  'id',
  'name',
  'lat',
  'lon',
  'wind',
  'country_id',
  'region_id',
  'subregion_id',
  'altitude',
  'altitudediff',
] as const
const TAKEOFF_FIELD_COUNT = TAKEOFF_HEADER.length

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// lat/lon are the only fields observed with a genuine negative value (Norway carries at
// least one data-entry glitch with a negative latitude) and the only fields observed with a
// decimal point at all — every other numeric field in this row was a bare integer across
// all 6012 sampled rows.
function readSignedFloat(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

function readNonNegativeInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

// altitude/altitudediff were a bare non-negative integer across every sampled Norway row,
// but a negative altitudediff (landing above takeoff) or a below-sea-level altitude is
// physically real and wasn't ruled out by that one country — allowing an optional sign
// means a genuinely negative value from an unsampled country parses correctly instead of
// tripping every row in that country's floor check.
function readSignedInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function toTakeoff(row: Nodes): Takeoff | null {
  const cells = row.children('td')
  if (cells.length !== TAKEOFF_FIELD_COUNT) return null

  const takeoffId = readNonNegativeInteger(cells.eq(0).text())
  const name = textOrNull(cells.eq(1).text())
  const lat = readSignedFloat(cells.eq(2).text())
  const lon = readSignedFloat(cells.eq(3).text())
  const wind = readNonNegativeInteger(cells.eq(4).text())
  const countryId = readNonNegativeInteger(cells.eq(5).text())
  const regionId = readNonNegativeInteger(cells.eq(6).text())
  const subregionId = readNonNegativeInteger(cells.eq(7).text())
  const altitude = readSignedInteger(cells.eq(8).text())
  const altitudeDiff = readSignedInteger(cells.eq(9).text())

  if (
    takeoffId === null ||
    name === null ||
    lat === null ||
    lon === null ||
    wind === null ||
    countryId === null ||
    regionId === null ||
    subregionId === null ||
    altitude === null ||
    altitudeDiff === null
  ) {
    return null
  }

  return { takeoffId, name, lat, lon, wind, countryId, regionId, subregionId, altitude, altitudeDiff }
}

function dedupeByTakeoffId(takeoffs: Takeoff[]): Takeoff[] {
  const seen = new Set<number>()
  return takeoffs.filter((takeoff) => {
    if (seen.has(takeoff.takeoffId)) return false
    seen.add(takeoff.takeoffId)
    return true
  })
}

// No honeypot exclusion here, unlike parse-clubs.ts/parse-pilot-search.ts — verified
// empirically (see parse-flightlog-table.ts) that rqtid=11's response carries zero <a> tags
// and zero hp-nav occurrences in both the full Norway capture and the empty Bouvet Island
// capture. There is no honeypot in this response family to exclude.
export function parseTakeoffs(html: string, countryId: number): Takeoff[] {
  const rows = extractDataRows(html, TAKEOFF_HEADER, 'Takeoff list')

  const takeoffs = rows.map(toTakeoff).filter((takeoff): takeoff is Takeoff => takeoff !== null)

  // A row we failed to strictly parse (wrong cell count, or a cell that didn't coerce) is
  // not the same as a country with genuinely zero takeoffs — extractDataRows already
  // confirmed the header shape, so any gap here means a candidate row silently didn't
  // become a Takeoff, not that the country legitimately has fewer of them.
  if (takeoffs.length !== rows.length) {
    throw new Error(
      `Takeoff list partially unparsed for country ${countryId}: ${takeoffs.length}/${rows.length} rows recognised`,
    )
  }

  return dedupeByTakeoffId(takeoffs)
}
