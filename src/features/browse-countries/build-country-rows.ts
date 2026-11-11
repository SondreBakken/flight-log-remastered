import type { Country, CountryCounts } from '@/lib/flightlog/types'

export type CountryRow = {
  countryId: number
  name: string
  pilots: number
  clubs: number
}

export function hasClubCounts(counts: CountryCounts | null): counts is CountryCounts {
  return counts !== null && counts.clubs.size > 0
}

function byName(a: Country, b: Country): number {
  return a.name.localeCompare(b.name)
}

// Join on country_id only and show the rqtid=9 name. Without club counts (a=3 failed or
// parsed empty) every country is listed by name, so unreadable a=3 markup never empties the page.
export function buildCountryRows(countries: Country[], counts: CountryCounts | null): CountryRow[] {
  if (!hasClubCounts(counts)) {
    return [...countries].sort(byName).map((country) => ({ ...country, pilots: 0, clubs: 0 }))
  }

  return countries
    .map((country) => ({
      ...country,
      pilots: counts.pilots.get(country.countryId) ?? 0,
      clubs: counts.clubs.get(country.countryId) ?? 0,
    }))
    .filter((row) => row.clubs > 0)
    .sort((a, b) => b.pilots - a.pilots || b.clubs - a.clubs || byName(a, b))
}
