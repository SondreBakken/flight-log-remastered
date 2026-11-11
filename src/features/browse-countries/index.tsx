import type { Country, CountryCounts } from '@/lib/flightlog/types'
import { buildCountryRows } from './build-country-rows'
import CountryList from './country-list'

export default function CountryIndex({
  countries,
  counts,
}: {
  countries: Country[]
  counts: CountryCounts | null
}) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Countries</h1>
      <p className="text-sm opacity-70">Pick a country to browse its clubs.</p>
      <CountryList data={buildCountryRows(countries, counts)} />
    </section>
  )
}
