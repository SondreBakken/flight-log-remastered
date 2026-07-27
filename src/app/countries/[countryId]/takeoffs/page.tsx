import { notFound } from 'next/navigation'
import TakeoffDirectory from '@/features/browse-country-takeoffs'
import { CURATED_TAKEOFF_COUNTRY_IDS, parseCuratedCountryId } from '@/lib/flightlog/curated-countries'
import { getCountries } from '@/lib/flightlog/countries'
import { getRegions } from '@/lib/flightlog/regions'

type TakeoffsParams = Promise<{ countryId: string }>

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
// getRegions had no caller before this. Norway's 29 regions are a few hundred bytes —
// nowhere near the 970 KB that made #38 fetch takeoffs as a SEPARATE browser-fetched asset
// (worth its own round trip specifically because embedding that much JSON directly in this
// page's initial HTML would bloat every load of it). At this size that tradeoff doesn't
// apply: calling getRegions here, inside the same generateStaticParams-prerendered page,
// embeds the names directly in the page's own static output — one fewer network request,
// one fewer loading/error state to build and test, for a payload embedding was always going
// to win on. getRegions already had the `use cache`/cacheTag machinery from #8; this is
// its first caller, not a new mechanism.
export default async function TakeoffsPage({ params }: { params: TakeoffsParams }) {
  const { countryId } = await params
  const id = parseCuratedCountryId(countryId)
  if (id === null) notFound()

  const [countries, regions] = await Promise.all([getCountries(), getRegions(id)])
  const countryName = countries.find((country) => country.countryId === id)?.name ?? `Country ${id}`
  const regionOptions = regions.map((region) => ({ regionId: region.regionId, name: region.name }))

  return <TakeoffDirectory countryId={id} countryName={countryName} regions={regionOptions} />
}
