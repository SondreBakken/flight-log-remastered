import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import CountryClubs from '@/features/browse-country-clubs'
import { getClubs } from '@/lib/flightlog/clubs'
import { getCountries } from '@/lib/flightlog/countries'
import { parseCanonicalCountryId } from '@/lib/flightlog/country-id'
import { CURATED_CLUB_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'

type CountryParams = Promise<{ countryId: string }>

// #40: prerenders the curated set (currently just Norway, the only club list this app has
// measured — see CURATED_CLUB_COUNTRIES's own doc comment) at build time, so `getClubs`'s
// 'days' cacheLife actually gets to do its job for the country pilots hit most, rather than
// re-running on every request the way it does on serverless when nothing ELSE keeps an
// instance warm (see getClubs's own doc comment). Unlike the sibling takeoffs route/page,
// this array does NOT gate which ids the page will serve — see Clubs below — only which ids
// get prerendered; every other well-formed id still renders normally, on demand.
export async function generateStaticParams(): Promise<{ countryId: string }[]> {
  return CURATED_CLUB_COUNTRY_IDS.map((countryId) => ({ countryId: String(countryId) }))
}

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
//
// Deliberately NOT parseCuratedCountryId: this page must keep working for every country
// (the /countries index links to all ~240 of them, not just the curated set prerendered
// above), so curation membership is not part of this guard. It still needs the alias
// rejection parseCanonicalCountryId provides — a bare `Number(countryId)` would accept
// `160.0`/`0xA0`/etc. as distinct, un-prerendered URLs for content identical to the curated
// `/countries/160`, the same duplicate-cache-key mistake #38's review caught on the takeoffs
// route (see curated-countries.ts's own doc comment).
export async function Clubs({ params }: { params: CountryParams }) {
  const { countryId } = await params
  const id = parseCanonicalCountryId(countryId)
  if (id === null || id <= 0) notFound()

  const [countries, clubs] = await Promise.all([getCountries(), getClubs(id)])
  // country_id values that are syntactically valid but do not exist (or exist but have
  // no clubs) are not distinguishable from "real country, zero clubs" on this endpoint —
  // both return 200 with an empty results table (confirmed live against Bouvet Island).
  // Falling through to the same empty-clubs rendering, rather than a second notFound(),
  // is the deliberate choice for an out-of-range numeric id.
  const countryName = countries.find((country) => country.countryId === id)?.name ?? `Country ${id}`

  return <CountryClubs countryId={id} countryName={countryName} clubs={clubs} />
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
