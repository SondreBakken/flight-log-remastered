import { extractDataRows, type Nodes } from './parse-flightlog-table'
import type { Country } from './types'

// Confirmed field order for rqtid=9 (all countries, 240 rows, no country_id needed — this is
// the one bare-table endpoint that isn't scoped per country). Same family as rqtid=10/regions
// and rqtid=11/takeoffs: identical "plainest response on the site" shape, confirmed empirically
// to carry zero <a> tags and zero hp-nav occurrences (see parse-flightlog-table.ts).
const COUNTRY_HEADER = [
  'a2_code',
  'a3_code',
  'createdby',
  'createdtime',
  'id',
  'name',
  'num_code',
  'timestamp',
  'updatedby',
  'updatedtime',
  'fips_a2',
] as const
const COUNTRY_FIELD_COUNT = COUNTRY_HEADER.length

const COUNTRY_ID_CELL_INDEX = 4
const COUNTRY_NAME_CELL_INDEX = 5

// `Number()` on its own is too permissive for an id: it reads an empty string as `0`, a
// hex literal like `0x10` as `16`, and a negative string as a negative number — all
// syntactically "numbers" but none a real country id. Same discipline as
// follow-store/follow-ids.ts: only a bare run of digits, and Number.isSafeInteger over the
// result, counts.
function readPositiveInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function toCountry(row: Nodes): Country | null {
  const cells = row.children('td')
  if (cells.length !== COUNTRY_FIELD_COUNT) return null

  const countryId = readPositiveInteger(cells.eq(COUNTRY_ID_CELL_INDEX).text())
  const name = cells.eq(COUNTRY_NAME_CELL_INDEX).text().trim()
  if (countryId === null || name === '') return null

  return { countryId, name }
}

export function parseCountries(html: string): Country[] {
  const rows = extractDataRows(html, COUNTRY_HEADER, 'Country list')

  const countries = rows.map(toCountry).filter((country): country is Country => country !== null)

  // A row we failed to parse is not the same as a page with no data rows at all — every
  // candidate row on this response is a genuine country row (rqtid=9 has no nav, no other
  // table), so any gap between candidate rows and parsed countries means one silently
  // dropped rather than the list legitimately being shorter.
  if (countries.length !== rows.length) {
    throw new Error(`Country list partially unparsed: ${countries.length}/${rows.length} rows recognised`)
  }

  return countries
}
