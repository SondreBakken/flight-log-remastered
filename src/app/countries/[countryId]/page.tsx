import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import CountryClubs from '@/features/browse-country-clubs'
import { getClubs } from '@/lib/flightlog/clubs'
import { getCountries } from '@/lib/flightlog/countries'

type CountryParams = Promise<{ countryId: string }>

export default function CountryPage({ params }: { params: CountryParams }) {
  return (
    <Suspense fallback={<ClubsSkeleton />}>
      <Clubs params={params} />
    </Suspense>
  )
}

// Exported (unlike the equivalent inner component on the other dynamic routes) so the
// notFound() guard can be exercised directly in page.test.tsx without a running Next.js
// request context. notFound() throws a special Next.js control-flow error carrying a
// `NEXT_HTTP_ERROR_FALLBACK;404` digest (asserted in page.test.tsx) — not a plain Error —
// but Vitest's plain `await`/`rejects` handling is enough to catch and assert on it without
// a router or request context.
export async function Clubs({ params }: { params: CountryParams }) {
  const { countryId } = await params
  const id = Number(countryId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [countries, clubs] = await Promise.all([getCountries(), getClubs(id)])
  // country_id values that are syntactically valid but do not exist (or exist but have
  // no clubs) are not distinguishable from "real country, zero clubs" on this endpoint —
  // both return 200 with an empty results table (confirmed live against Bouvet Island).
  // Falling through to the same empty-clubs rendering, rather than a second notFound(),
  // is the deliberate choice for an out-of-range numeric id.
  const countryName = countries.find((country) => country.countryId === id)?.name ?? `Country ${id}`

  return <CountryClubs countryName={countryName} clubs={clubs} />
}

function ClubsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
