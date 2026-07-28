import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import TakeoffDirectory from '@/features/browse-country-takeoffs'
import { parseWindFilterParam, type RegionOption, type WindFilter } from '@/features/browse-country-takeoffs/select-visible-takeoffs'
import { CURATED_TAKEOFF_COUNTRY_IDS, parseCuratedCountryId } from '@/lib/flightlog/curated-countries'
import { getCountries } from '@/lib/flightlog/countries'
import { getRegions } from '@/lib/flightlog/regions'

type TakeoffsParams = Promise<{ countryId: string }>
type TakeoffsSearchParams = Promise<{ wind?: string | string[] }>

// Same curated set the takeoffs API route serves — a country outside it can never succeed
// against that route (see route.ts's own 404 guard, the replacement for `dynamicParams =
// false`, which Cache Components rejects — see dynamicParams.md), so this page 404s up
// front too rather than rendering a directory that can only ever show a fetch error.
export async function generateStaticParams(): Promise<{ countryId: string }[]> {
  return CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => ({ countryId: String(countryId) }))
}

// #9's directory page, replacing #38's proof-of-mechanism preview — that component's own
// comment said it should be, the moment an input with live filtering showed up (see
// features/browse-country-takeoffs's own doc comment). Exported (like Clubs on the sibling
// /countries/[countryId] route) so the notFound() guard can be exercised directly in
// page.test.tsx without a request context.
//
// Region names: #8's wire payload carries `regionId` but nothing maps it to a name, and
// getRegions had no caller before this. Norway's 29 regions serialise to 1041 bytes as
// `{regionId, name}[]` (measured against the real fixture) — nowhere near the 970 KB that
// made #38 fetch takeoffs as a SEPARATE browser-fetched asset
// (worth its own round trip specifically because embedding that much JSON directly in this
// page's initial HTML would bloat every load of it). At this size that tradeoff doesn't
// apply: calling getRegions here, inside the same generateStaticParams-prerendered page,
// embeds the names directly in the page's own static output — one fewer network request,
// one fewer loading/error state to build and test, for a payload embedding was always going
// to win on. getRegions already had the `use cache`/cacheTag machinery from #8; this is
// its first caller, not a new mechanism.
//
// #12's `?wind=` read is deliberately NOT here. Reading `searchParams` outside a `<Suspense>`
// boundary forces Cache Components to treat the whole route as dynamic (see
// migrating-to-cache-components.md's "blocking-route" guidance) — countries/regions above have
// no such dependency and stay part of the static shell built by generateStaticParams. Only
// TakeoffsWindParam below, wrapped in Suspense, touches searchParams, so it's the only part of
// this route that resolves per-request rather than at build time.
export default async function TakeoffsPage({ params, searchParams }: { params: TakeoffsParams; searchParams: TakeoffsSearchParams }) {
  const { countryId } = await params
  const id = parseCuratedCountryId(countryId)
  if (id === null) notFound()

  const [countries, regions] = await Promise.all([getCountries(), getRegions(id)])
  const countryName = countries.find((country) => country.countryId === id)?.name ?? `Country ${id}`
  const regionOptions = regions.map((region) => ({ regionId: region.regionId, name: region.name }))

  return (
    <Suspense fallback={<TakeoffsSkeleton countryName={countryName} />}>
      <TakeoffsWindParam searchParams={searchParams} countryId={id} countryName={countryName} regions={regionOptions} />
    </Suspense>
  )
}

// Nearby (#12's other filter) deliberately has no URL counterpart — see
// browse-country-takeoffs/index.tsx's own comment on why: it depends on a runtime permission
// grant and the device's current position, neither of which a URL can replay. Wind alone is
// shareable, small, and safely validated, which is why it's the one filter threaded through
// here.
//
// Isolated into its own component (mirroring pilots/search/page.tsx's Search) specifically so
// only the read of `searchParams` is wrapped in Suspense, not the country/region fetch above —
// and so page.test.tsx can exercise this parsing step directly, the same way that sibling
// route's tests exercise Search directly.
export async function TakeoffsWindParam({
  searchParams,
  countryId,
  countryName,
  regions,
}: {
  searchParams: TakeoffsSearchParams
  countryId: number
  countryName: string
  regions: RegionOption[]
}) {
  const { wind } = await searchParams
  const initialWindFilter: WindFilter = parseWindFilterParam(typeof wind === 'string' ? wind : undefined)

  return <TakeoffDirectory countryId={countryId} countryName={countryName} regions={regions} initialWindFilter={initialWindFilter} />
}

// Prerendered into the static shell in place of the real directory while TakeoffsWindParam's
// searchParams read resolves — countryName is already known at this point (it doesn't depend
// on searchParams), so the header renders immediately with no flash once the real content
// streams in.
function TakeoffsSkeleton({ countryName }: { countryName: string }) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{countryName} takeoffs</h1>
      </header>
      <div className="h-8 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </section>
  )
}
