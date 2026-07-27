import Link from 'next/link'
import type { Country } from '@/lib/flightlog/types'

export default function CountryIndex({ countries }: { countries: Country[] }) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Countries</h1>
      <p className="text-sm opacity-70">Pick a country to browse its clubs.</p>
      <CountryList countries={countries} />
    </section>
  )
}

function CountryList({ countries }: { countries: Country[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
      {countries.map((country) => (
        <li key={country.countryId}>
          <Link className="underline underline-offset-2" href={`/countries/${country.countryId}`}>
            {country.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}
