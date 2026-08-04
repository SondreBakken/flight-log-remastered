import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import FlownSitesSection from '@/features/browse-flown-sites-map'
import PilotLogbook from '@/features/browse-pilot-logbook'
import PilotStatistics from '@/features/browse-pilot-statistics'
import { flightYear } from '@/lib/flightlog/flight-year'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import type { Flight } from '@/lib/flightlog/types'

type PilotParams = Promise<{ userId: string }>

function yearsCovered(flights: Flight[]): number[] {
  return [...new Set(flights.map(flightYear))]
}

export default function PilotPage({ params }: { params: PilotParams }) {
  return (
    <Suspense fallback={<LogbookSkeleton />}>
      <Logbook params={params} />
    </Suspense>
  )
}

async function Logbook({ params }: { params: PilotParams }) {
  const { userId } = await params
  const pilotId = Number(userId)
  if (!Number.isInteger(pilotId) || pilotId <= 0) notFound()

  const { pilot, flights } = await getPilotLogbook(pilotId)
  const trackedTripIds = await getTrackedTripIds(pilotId, yearsCovered(flights))

  return (
    <div className="flex flex-col gap-10">
      <PilotLogbook pilot={pilot} flights={flights} trackedTripIds={trackedTripIds} />
      <PilotStatistics flights={flights} />
      {/* #76: its own nested Suspense boundary, not covered by LogbookSkeleton below — this
          section has its own fetch (getTakeoffs(160), on top of the logbook this component
          already awaited above), so it streams in independently once the rest of the
          dashboard (which needed no new fetch) is already on screen. */}
      <Suspense fallback={<FlownSitesSkeleton />}>
        <FlownSitesSection userId={pilotId} />
      </Suspense>
    </div>
  )
}

function FlownSitesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}

// The streamed payload behind this Suspense boundary is PilotLogbook AND PilotStatistics
// together (see Logbook below) — a skeleton modelling only the logbook's own header-plus-table
// shape under-promises how much taller the real content is, so this adds a second block roughly
// standing in for the statistics section's own header-plus-panels shape.
function LogbookSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="h-8 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-4 w-72 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-6 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-4 w-64 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="h-32 animate-pulse rounded bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  )
}
