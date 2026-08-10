import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import TakeoffDetailView from '@/features/browse-takeoff-detail'
import { hasKnownLocation } from '@/lib/flightlog/has-known-location'
import { getCountries } from '@/lib/flightlog/countries'
import { parseCuratedCountryId } from '@/lib/flightlog/curated-countries'
import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import { getTakeoffFlights } from '@/lib/flightlog/takeoff-flights'
import { getTakeoffs } from '@/lib/flightlog/takeoffs'
import { resolveViewerFollowState } from '@/lib/follows/resolve-viewer-follow-state'

type TakeoffDetailParams = Promise<{ countryId: string; takeoffId: string }>

export default function TakeoffDetailPage({ params }: { params: TakeoffDetailParams }) {
  return (
    <Suspense fallback={<TakeoffDetailSkeleton />}>
      <TakeoffDetail params={params} />
    </Suspense>
  )
}

// #11's detail page, sibling to #9's directory at /countries/[countryId]/takeoffs — same
// curation gate (parseCuratedCountryId), for the same reason: the country's own takeoffs
// dataset (rqtid=11, fetched below for the map) is what this app has actually measured and
// chosen to serve, and the directory a pilot would reach this page FROM already 404s outside
// that set, so a direct link to an uncurated country's takeoff can never have been produced by
// this app either.
//
// No generateStaticParams: unlike the country segment, takeoffId ranges over thousands of
// real ids per curated country (6012 for Norway alone) with no way to usefully prerender all
// of them, the same reasoning /flights/[tripId] already applies to trip ids.
//
// Exported (like Clubs/TakeoffsPage's own inner component) so the notFound() guards are
// exercised directly in page.test.tsx without a request context.
export async function TakeoffDetail({ params }: { params: TakeoffDetailParams }) {
  const { countryId: countryIdParam, takeoffId: takeoffIdParam } = await params
  const countryId = parseCuratedCountryId(countryIdParam)
  if (countryId === null) notFound()

  // Same guard /flights/[tripId] uses for its own dynamic id segment — no canonical-spelling
  // rejection the way countryId gets (see parseCuratedCountryId's own doc comment): this
  // route is never statically generated, so there is no prerendered artifact for an alias
  // spelling to collide with.
  const takeoffId = Number(takeoffIdParam)
  if (!Number.isInteger(takeoffId) || takeoffId <= 0) notFound()

  // All four run in parallel: detail/flights/takeoffs are independent fetches (getTakeoffs is
  // 'days'-cached already, so this is effectively free after the first hit for the country),
  // and — same reasoning /countries/[countryId]/page.tsx uses for getClubs — fetching flights
  // even for a start_id that turns out not to exist costs one extra request in the rare
  // not-found case, not a second round trip in the common one.
  const [countries, detail, flights, takeoffs] = await Promise.all([
    getCountries(),
    getTakeoffDetail(countryId, takeoffId),
    getTakeoffFlights(countryId, takeoffId),
    getTakeoffs(countryId),
  ])

  // The one signal that actually distinguishes "no such takeoff" from "a real takeoff with
  // sparse data" — see parseTakeoffDetail's own doc comment. flights' own emptiness is never
  // used for this: a real takeoff with zero flights this year renders the identical empty
  // shell a nonexistent start_id does (see parseTakeoffFlights' doc comment), so trusting it
  // here would 404 a real, quiet takeoff.
  if (detail === null) notFound()

  // getTakeoffFlights returning null here means a=42's OWN identity signal disagrees with
  // a=22's, which just confirmed (above) that this takeoff is real — not the ordinary 404 case
  // (that already returned above), a genuine inconsistency between two independently-fetched,
  // independently-cached responses. Thrown, not silently treated as zero flights: a thrown
  // error is never cached, where a confident-but-wrong empty list would be (see
  // takeoff-flights.ts's own doc comment).
  if (flights === null) {
    throw new Error(
      `Takeoff ${takeoffId} (country ${countryId}): a=42 reports no such takeoff but a=22 confirms it exists`,
    )
  }

  const countryName = countries.find((country) => country.countryId === countryId)?.name ?? `Country ${countryId}`

  // #11's explicit rule: no a=22 coordinate fallback (confirmed absent, not merely empty, for
  // a corrupt-coordinate takeoff — see the issue's own measurement). The ONLY coordinate
  // source is the country's rqtid=11 dataset, reusing hasKnownLocation so a takeoff with a
  // corrupt or placeholder position (Null Island, a lat/lon swap — see that function's own
  // doc comment) omits the map entirely rather than rendering one at a fabricated location.
  const locationEntry = takeoffs.find((takeoff) => takeoff.takeoffId === takeoffId)
  const mapEntry = locationEntry && hasKnownLocation(locationEntry) ? locationEntry : null

  const candidatePilotIds = [...new Set(flights.map((flight) => flight.userId))]
  const { isSignedIn, followedPilotIds } = await resolveViewerFollowState(candidatePilotIds)

  return (
    <TakeoffDetailView
      countryId={countryId}
      countryName={countryName}
      detail={detail}
      flights={flights}
      mapEntry={mapEntry}
      currentYear={new Date().getFullYear()}
      isSignedIn={isSignedIn}
      followedPilotIds={followedPilotIds}
    />
  )
}

function TakeoffDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-64 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
