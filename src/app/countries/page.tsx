import { Suspense } from 'react'
import CountryIndex from '@/features/browse-countries'
import { getCountries } from '@/lib/flightlog/countries'

export default function CountriesPage() {
  return (
    <Suspense fallback={<CountriesSkeleton />}>
      <Countries />
    </Suspense>
  )
}

async function Countries() {
  const countries = await getCountries()
  return <CountryIndex countries={countries} />
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
