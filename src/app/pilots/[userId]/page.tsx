import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import FlownSitesSection from '@/features/browse-flown-sites-map'
import PilotLogbook from '@/features/browse-pilot-logbook'
import PilotStatistics from '@/features/browse-pilot-statistics'
import { flightYear } from '@/lib/flightlog/flight-year'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { resolveViewerFollowState, toFollowButtonState } from '@/lib/follows/resolve-viewer-follow-state'
import type { Flight } from '@/lib/flightlog/types'

type PilotParams = Promise<{ userId: string }>

function yearsCovered(flights: Flight[]): number[] {
  return [...new Set(flights.map(flightYear))]
}

// Shared by Logbook and FlownSites below, so the pilot-id parse/notFound guard exists in exactly
// one place rather than drifting into two copies. Pure `params` reads (await + parse, no I/O),
// so calling it once per sibling Suspense boundary costs nothing worth avoiding — the point of
// splitting Logbook and FlownSites into siblings is precisely so EACH branch can start its own
// real fetch without waiting on the other's.
async function parsePilotId(params: PilotParams): Promise<number> {
  const { userId } = await params
  const pilotId = Number(userId)
  if (!Number.isInteger(pilotId) || pilotId <= 0) notFound()
  return pilotId
}

// Two sibling Suspense boundaries, not one covering both — Logbook's own fetch chain
// (getPilotLogbook, then getTrackedTripIds) has nothing FlownSites needs (it only needs
// pilotId), so nesting FlownSites inside Logbook's tree would serialize its own fetch
// (getTakeoffs(160)) behind both of Logbook's fetches for no reason. As siblings, both branches'
// fetches start concurrently the moment pilotId resolves.
export default function PilotPage({ params }: { params: PilotParams }) {
  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={<LogbookSkeleton />}>
        <Logbook params={params} />
      </Suspense>
      <Suspense fallback={<FlownSitesSkeleton />}>
        <FlownSites params={params} />
      </Suspense>
    </div>
  )
}

async function Logbook({ params }: { params: PilotParams }) {
  const pilotId = await parsePilotId(params)
  const { pilot, flights } = await getPilotLogbook(pilotId)
  const [trackedTripIds, followState] = await Promise.all([
    getTrackedTripIds(pilotId, yearsCovered(flights)),
    resolveViewerFollowState([pilotId]),
  ])
  const { isSignedIn, followedPilotIds } = toFollowButtonState(followState)

  return (
    <>
      <PilotLogbook
        pilot={pilot}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={followedPilotIds.includes(pilotId)}
        isSignedIn={isSignedIn}
      />
      <PilotStatistics flights={flights} />
    </>
  )
}

async function FlownSites({ params }: { params: PilotParams }) {
  const pilotId = await parsePilotId(params)
  return <FlownSitesSection userId={pilotId} />
}

// #76's fallback for the FlownSites Suspense boundary above — a sibling of Logbook's own, not
// nested inside it (see PilotPage's own doc comment for why: the two branches' fetches must
// start concurrently, not serialize one behind the other).
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
