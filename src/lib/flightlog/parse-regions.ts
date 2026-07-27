import { extractDataRows, type Nodes } from './parse-flightlog-table'
import type { Region } from './types'

// Confirmed field order for rqtid=10 (Norway, country_id=160 — 29 rows, and Bouvet Island,
// country_id=29 — 0 rows, both header-only-verified). createdby/createdtime/timestamp/
// updatedby/updatedtime are metadata cruft, same family as rqtid=9/countries' a2_code/
// fips_a2/etc — trimmed at the parse boundary rather than carried, following that precedent.
const REGION_HEADER = [
  'country_id',
  'createdby',
  'createdtime',
  'id',
  'name',
  'timestamp',
  'updatedby',
  'updatedtime',
] as const
const REGION_FIELD_COUNT = REGION_HEADER.length

const COUNTRY_ID_CELL_INDEX = 0
const REGION_ID_CELL_INDEX = 3
const NAME_CELL_INDEX = 4

function readNonNegativeInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function toRegion(row: Nodes): Region | null {
  const cells = row.children('td')
  if (cells.length !== REGION_FIELD_COUNT) return null

  const countryId = readNonNegativeInteger(cells.eq(COUNTRY_ID_CELL_INDEX).text())
  const regionId = readNonNegativeInteger(cells.eq(REGION_ID_CELL_INDEX).text())
  const name = cells.eq(NAME_CELL_INDEX).text().trim()
  if (countryId === null || regionId === null || name === '') return null

  return { regionId, name, countryId }
}

function dedupeByRegionId(regions: Region[]): Region[] {
  const seen = new Set<number>()
  return regions.filter((region) => {
    if (seen.has(region.regionId)) return false
    seen.add(region.regionId)
    return true
  })
}

// No honeypot exclusion here, unlike parse-clubs.ts/parse-pilot-search.ts — verified
// empirically (see parse-flightlog-table.ts) that rqtid=10's response carries zero <a> tags
// and zero hp-nav occurrences in both the full Norway capture and the empty Bouvet Island
// capture. There is no honeypot in this response family to exclude.
export function parseRegions(html: string, countryId: number): Region[] {
  const rows = extractDataRows(html, REGION_HEADER, 'Region list')

  const regions = rows.map(toRegion).filter((region): region is Region => region !== null)

  // Same distinction parse-takeoffs.ts draws: a row that failed strict extraction is not
  // the same as a country with genuinely zero regions.
  if (regions.length !== rows.length) {
    throw new Error(
      `Region list partially unparsed for country ${countryId}: ${regions.length}/${rows.length} rows recognised`,
    )
  }

  return dedupeByRegionId(regions)
}
