import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import FlownSitesSection from '@/features/browse-flown-sites-map'
import PilotCertificateProgress from '@/features/browse-pilot-certificate'
import PilotLogbook from '@/features/browse-pilot-logbook'
import PilotStatistics from '@/features/browse-pilot-statistics'
import { flightYear } from '@/lib/flightlog/flight-year'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { isFallbackPilot } from '@/lib/flightlog/is-fallback-pilot'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { resolveFollowButtonState } from '@/lib/follows/resolve-viewer-follow-state'
import { resolveCertificateProgressState } from '@/lib/profiles/resolve-certificate-progress-state'
import { resolvePilotVerified } from '@/lib/profiles/resolve-pilot-verified'
import type { Flight } from '@/lib/flightlog/types'

type PilotParams = Promise<{ userId: string }>

function yearsCovered(flights: Flight[]): number[] {
  return [...new Set(flights.map(flightYear))]
}

// Shared by Logbook and FlownSites below, so the pilot-id parse/notFound guard exists in exactly
// one place rather than drifting into two copies. Pure `params` reads (await + parse, no I/O),
// so calling it once per Suspense boundary costs nothing worth avoiding.
async function parsePilotId(params: PilotParams): Promise<number> {
  const { userId } = await params
  const pilotId = Number(userId)
  if (!Number.isInteger(pilotId) || pilotId <= 0) notFound()
  return pilotId
}

// Same loader and id parse as Logbook, so the 'use cache' entry is shared (no second fetch); the
// same isFallbackPilot guard keeps a 404 from ever being titled with the synthetic `Pilot <id>`.
export async function generateMetadata({ params }: { params: PilotParams }): Promise<Metadata> {
  const pilotId = await parsePilotId(params)
  const { pilot } = await getPilotLogbook(pilotId)
  if (isFallbackPilot(pilotId, pilot)) notFound()
  return { title: pilot.name }
}

// The flown-sites map sits between the logbook's summary and its table, so it is rendered
// inside Logbook (as PilotLogbook's map slot) rather than as a sibling. Its fetch therefore
// starts after Logbook's own fetches finish — accepted, since the requested order puts the map
// above the table; the map keeps its own Suspense boundary and skeleton.
export default function PilotPage({ params }: { params: PilotParams }) {
  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={<LogbookSkeleton />}>
        <Logbook params={params} />
      </Suspense>
    </div>
  )
}

// Exported (same reasoning as Flight in the sibling flights/[tripId]/page.tsx) so the
// isFallbackPilot notFound() guard is exercised directly in page.test.tsx without a request
// context.
export async function Logbook({ params }: { params: PilotParams }) {
  const pilotId = await parsePilotId(params)
  const { pilot, flights } = await getPilotLogbook(pilotId)
  // #239: parsePilot cannot itself tell "no such pilot" from "a real pilot with an empty
  // profile" apart — both degrade to the identical synthetic fallback shape (see
  // is-fallback-pilot.ts's own doc comment) — so without this check a nonexistent pilot id
  // rendered as a normal, empty logbook instead of 404ing.
  if (isFallbackPilot(pilotId, pilot)) notFound()
  const [trackedTripIds, { isSignedIn, followedPilotIds }, certificateProgress, isVerified] = await Promise.all([
    getTrackedTripIds(pilotId, yearsCovered(flights)),
    resolveFollowButtonState([pilotId]),
    resolveCertificateProgressState(pilotId),
    resolvePilotVerified(pilotId),
  ])

  return (
    <>
      <PilotLogbook
        pilot={pilot}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={followedPilotIds.includes(pilotId)}
        isSignedIn={isSignedIn}
        isVerified={isVerified}
        mapSlot={
          <Suspense fallback={<FlownSitesSkeleton />}>
            <FlownSites params={params} />
          </Suspense>
        }
      />
      <PilotStatistics flights={flights} />
      <PilotCertificateProgress
        checklist={certificateProgress.checklist}
        flights={flights}
        isOwner={certificateProgress.isOwner}
        level={certificateProgress.level}
        levelSetAt={certificateProgress.levelSetAt}
      />
    </>
  )
}

async function FlownSites({ params }: { params: PilotParams }) {
  const pilotId = await parsePilotId(params)
  return <FlownSitesSection userId={pilotId} />
}

// #76's fallback for the FlownSites Suspense boundary, nested in Logbook's map slot.
function FlownSitesSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-testid="flown-sites-skeleton">
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
