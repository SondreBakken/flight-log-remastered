import * as cheerio from 'cheerio'
import type { Country } from './types'

type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

const COUNTRY_ROW_CELL_COUNT = 11
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

function toCountry(cells: Nodes): Country | null {
  if (cells.length !== COUNTRY_ROW_CELL_COUNT) return null

  const countryId = readPositiveInteger(cells.eq(COUNTRY_ID_CELL_INDEX).text())
  const name = cells.eq(COUNTRY_NAME_CELL_INDEX).text().trim()
  if (countryId === null || name === '') return null

  return { countryId, name }
}

export function parseCountries(html: string): Country[] {
  const $ = cheerio.load(html)
  // The 11 <th> header cells are not wrapped in a <tr> in the source, but cheerio's parser
  // still synthesizes one as a leading sibling of the data rows — a real <tr>, just not a
  // data row. `td` presence, not row position, is what tells the two apart: the synthesized
  // header row has none.
  const candidateRows = $('table tr')
    .toArray()
    .map((row) => $(row))
    .filter((row) => row.children('td').length > 0)
  if (candidateRows.length === 0) {
    throw new Error('Country list markup not recognised: found no rows with <td> cells')
  }

  const countries = candidateRows
    .map((row) => toCountry(row.children('td')))
    .filter((country): country is Country => country !== null)

  // A row we failed to parse is not the same as a page with no data rows at all — every
  // candidate row on this response is a genuine country row (rqtid=9 has no nav, no other
  // table), so any gap between candidate rows and parsed countries means one silently
  // dropped rather than the list legitimately being shorter.
  if (countries.length !== candidateRows.length) {
    throw new Error(
      `Country list partially unparsed: ${countries.length}/${candidateRows.length} rows recognised`,
    )
  }

  return countries
}
