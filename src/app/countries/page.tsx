import type { Metadata } from 'next'
import { Suspense } from 'react'
import CountryIndex from '@/features/browse-countries'
import { getCountries } from '@/lib/flightlog/countries'
import { getCountryCounts } from '@/lib/flightlog/country-counts'

export const metadata: Metadata = { title: 'Countries' }

export default function CountriesPage() {
  return (
    <Suspense fallback={<CountriesSkeleton />}>
      <Countries />
    </Suspense>
  )
}

// A failed a=3 fetch (or one that parsed to no club counts, which getCountryCounts throws on)
// must not take the page down: null counts make the index fall back to the plain list.
export async function Countries() {
  const [countries, entries] = await Promise.all([
    getCountries(),
    getCountryCounts().catch(() => null),
  ])
  const counts = entries && { pilots: new Map(entries.pilots), clubs: new Map(entries.clubs) }
  return <CountryIndex countries={countries} counts={counts} />
}

function CountriesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-64 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
