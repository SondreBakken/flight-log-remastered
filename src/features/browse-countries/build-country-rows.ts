import type { Country, CountryCounts } from '@/lib/flightlog/types'

export type CountryRow = {
  countryId: number
  name: string
  pilots: number
  clubs: number
}

function hasClubCounts(counts: CountryCounts | null): counts is CountryCounts {
  return counts !== null && counts.clubs.size > 0
}

export type CountryListData =
  | { kind: 'ranked'; rows: CountryRow[] }
  | { kind: 'fallback'; countries: Country[] }

function byName(a: Country, b: Country): number {
  return a.name.localeCompare(b.name)
}

// Join on country_id only and show the rqtid=9 name. Without club counts (a=3 failed or
// parsed empty) the result is a `fallback` listing every country by name, so unreadable a=3
// markup never empties the page.
export function buildCountryRows(countries: Country[], counts: CountryCounts | null): CountryListData {
  if (!hasClubCounts(counts)) {
    return { kind: 'fallback', countries: [...countries].sort(byName) }
  }

  const rows = countries
    .map((country) => ({
      ...country,
      pilots: counts.pilots.get(country.countryId) ?? 0,
      clubs: counts.clubs.get(country.countryId) ?? 0,
    }))
    .filter((row) => row.clubs > 0)
    .sort((a, b) => b.pilots - a.pilots || b.clubs - a.clubs || byName(a, b))

  return { kind: 'ranked', rows }
}
