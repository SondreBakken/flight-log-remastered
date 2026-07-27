import { notFound } from 'next/navigation'
import TakeoffsPreview from '@/features/preview-country-takeoffs'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'

type TakeoffsParams = Promise<{ countryId: string }>

// Same curated set the takeoffs API route serves — a country outside it can never succeed
// against that route (see route.ts's own 404 guard, the replacement for `dynamicParams =
// false`, which Cache Components rejects — see dynamicParams.md), so this page 404s up
// front too rather than rendering a preview that can only ever show a fetch error.
export async function generateStaticParams(): Promise<{ countryId: string }[]> {
  return CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => ({ countryId: String(countryId) }))
}

// #38's proof-of-mechanism page: fetches the prerendered per-country takeoffs asset in a
// real browser render (see features/preview-country-takeoffs) and shows how many rows
// loaded, nothing else. Exported (like Clubs on the sibling /countries/[countryId] route) so
// the notFound() guard can be exercised directly in page.test.tsx without a request context.
export default async function TakeoffsPage({ params }: { params: TakeoffsParams }) {
  const { countryId } = await params
  const id = Number(countryId)
  if (!Number.isInteger(id) || !CURATED_TAKEOFF_COUNTRY_IDS.includes(id)) notFound()

  return <TakeoffsPreview countryId={id} />
}
