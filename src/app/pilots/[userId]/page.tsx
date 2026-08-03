import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import PilotLogbook from '@/features/browse-pilot-logbook'
import PilotStatistics from '@/features/browse-pilot-statistics'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import type { Flight } from '@/lib/flightlog/types'

type PilotParams = Promise<{ userId: string }>

function yearsCovered(flights: Flight[]): number[] {
  return [...new Set(flights.map((flight) => Number(flight.date.slice(0, 4))))]
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
    </div>
  )
}

function LogbookSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-72 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
