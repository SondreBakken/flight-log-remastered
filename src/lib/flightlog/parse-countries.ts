import * as cheerio from 'cheerio'
import type { Country } from './types'

type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

const COUNTRY_ROW_CELL_COUNT = 11
const COUNTRY_ID_CELL_INDEX = 4
const COUNTRY_NAME_CELL_INDEX = 5

function toCountry(cells: Nodes): Country | null {
  if (cells.length !== COUNTRY_ROW_CELL_COUNT) return null

  const countryId = Number(cells.eq(COUNTRY_ID_CELL_INDEX).text())
  const name = cells.eq(COUNTRY_NAME_CELL_INDEX).text().trim()
  if (!Number.isInteger(countryId) || name === '') return null

  return { countryId, name }
}

export function parseCountries(html: string): Country[] {
  const $ = cheerio.load(html)
  const countries = $('table tr')
    .toArray()
    .map((row) => toCountry($(row).children('td')))
    .filter((country): country is Country => country !== null)

  if (countries.length === 0) {
    throw new Error('Country list markup not recognised: found no rows with 11 <td> cells')
  }

  return countries
}
