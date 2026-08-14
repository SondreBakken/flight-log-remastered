import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import FlightTrack from '@/features/show-flight-track'
import CommentsOnFlight from '@/features/comment-on-flight'
import { flightlogFlightUrl } from '@/lib/flightlog/config'
import { getTrack, hasTrack } from '@/lib/flightlog/tracks'

type FlightParams = Promise<{ tripId: string }>

export default function FlightPage({ params }: { params: FlightParams }) {
  return (
    <article className="flex flex-col gap-6">
      <Suspense fallback={<FlightSkeleton />}>
        <Flight params={params} />
      </Suspense>
      <Link className="text-sm underline underline-offset-2" href="/">
        Back to logbook
      </Link>
    </article>
  )
}

// Exported (same reasoning as TakeoffDetail in the sibling takeoffs/[takeoffId]/page.tsx) so the
// hasTrack/getTrack guard is exercised directly in page.test.tsx without a request context.
export async function Flight({ params }: { params: FlightParams }) {
  const { tripId } = await params
  const id = Number(tripId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  // Most flights have no GPS track (#213 made every row reachable here, tracked or not), and
  // parseTrack deliberately throws when a trip has no track placemark at all — kept loud so a
  // genuinely malformed real track is never silently treated as empty. Checking hasTrack first
  // keeps that throw meaningful by only calling getTrack for trips that actually have a track.
  const trackAvailable = await hasTrack(id)
  const track = trackAvailable ? await getTrack(id) : null

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Flight {id}</h1>
        <a
          className="text-sm underline underline-offset-2 opacity-70"
          href={flightlogFlightUrl(id)}
          target="_blank"
          rel="noreferrer"
        >
          View on flightlog.org
        </a>
      </header>
      {track ? <FlightTrack track={track} /> : <NoTrackNotice />}
      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsOnFlight tripId={id} />
      </Suspense>
    </>
  )
}

function NoTrackNotice() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No GPS track for this flight.
    </p>
  )
}

function FlightSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-[70vh] w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
      <CommentsSkeleton />
    </div>
  )
}

function CommentsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-28 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="flex flex-col gap-3">
        <div className="h-16 w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
        <div className="h-16 w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
      </div>
      <div className="h-24 w-full animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
