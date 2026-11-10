import { Fragment, Suspense } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import FlightTrack from '@/features/show-flight-track'
import CommentsOnFlight from '@/features/comment-on-flight'
import { CalendarDate } from '@/components/calendar-date'
import { BackLink } from '@/features/browse-flight-detail/back-link'
import { flightlogFlightUrl } from '@/lib/flightlog/config'
import { getFlightDetail } from '@/lib/flightlog/flight-detail'
import { getTrack, hasTrack } from '@/lib/flightlog/tracks'
import type { FlightDetail } from '@/lib/flightlog/types'

type FlightParams = Promise<{ tripId: string }>

export default function FlightPage({ params }: { params: FlightParams }) {
  return (
    <article className="flex flex-col gap-6">
      <Suspense fallback={<FlightSkeleton />}>
        <Flight params={params} />
      </Suspense>
      <BackLink />
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

  // #215: an untracked trip still has a real a=34 record most of the time — flightlog.org's own
  // page for one renders a plain detail table instead of nothing, so this app does too. A tracked
  // trip fetches it too (#303) for the pilot, takeoff and date heading and the distance, but
  // there it is only decoration: a fetch or parse failure must not take down a track page that
  // works without it, so the failure degrades to null instead of propagating.
  const detail = trackAvailable ? await getDetailOrNull(id) : await getFlightDetail(id)

  // A trip with neither a GPS track NOR an a=34 record is not "untracked" — it does not exist.
  // Same convention /countries/[countryId]/takeoffs/[takeoffId]/page.tsx already uses for its
  // own detail === null case: getFlightDetail returning null is itself flightlog.org's own
  // positive "no such trip_id" signal (see parseFlightDetail's own doc comment), not a scrape
  // failure — a genuine scrape failure throws instead, and is left to propagate for an
  // untracked trip rather than being caught here, the same "kept loud" reasoning parseTrack's
  // own throw already documents above.
  if (!trackAvailable && detail === null) notFound()

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {track ? <FlightHeading id={id} detail={detail} /> : `Flight ${id}`}
        </h1>
        <a
          className="flex w-fit items-center gap-1 text-sm underline underline-offset-2 opacity-70"
          href={flightlogFlightUrl(id)}
          target="_blank"
          rel="noreferrer"
        >
          View on flightlog.org
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      </header>
      {track ? <FlightTrack track={track} distanceKm={detail?.distanceKm} /> : <FlightDetailTable detail={detail!} />}
      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsOnFlight tripId={id} />
      </Suspense>
    </>
  )
}

async function getDetailOrNull(id: number): Promise<FlightDetail | null> {
  try {
    return await getFlightDetail(id)
  } catch {
    return null
  }
}

// `pilot, takeoff, date` for a tracked flight; a part the detail lacks is omitted, and with no
// part at all it falls back to the bare `Flight {id}`.
function FlightHeading({ id, detail }: { id: number; detail: FlightDetail | null }) {
  const parts = detail ? headingParts(detail) : []
  if (parts.length === 0) return <>Flight {id}</>
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ', '}
          {part}
        </Fragment>
      ))}
    </>
  )
}

function headingParts(detail: FlightDetail): ReactNode[] {
  const parts: ReactNode[] = []
  if (detail.pilot) {
    parts.push(
      <Link className="underline underline-offset-2" href={`/pilots/${detail.pilot.userId}`}>
        {detail.pilot.name}
      </Link>,
    )
  }
  if (detail.takeoff !== null) parts.push(<TakeoffLabel detail={detail} />)
  if (detail.date !== null) parts.push(<CalendarDate value={detail.date} />)
  return parts
}

// Shared by the heading and the untracked detail table so both link the takeoff the same way.
function TakeoffLabel({ detail }: { detail: FlightDetail }) {
  if (!detail.takeoffRef) return <>{detail.takeoff}</>
  return (
    <Link
      className="underline underline-offset-2"
      href={`/countries/${detail.takeoffRef.countryId}/takeoffs/${detail.takeoffRef.takeoffId}`}
    >
      {detail.takeoff}
    </Link>
  )
}

// flightlog.org's own a=34 page for an untracked flight, in place of nothing — same `<dl>`
// label/value convention browse-club/index.tsx's own ClubHeader already uses for an optional
// field list, rather than a new table style invented for this one page.
function FlightDetailTable({ detail }: { detail: FlightDetail }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-dashed border-black/15 p-6 text-sm dark:border-white/20">
      {detail.date !== null && (
        <>
          <dt className="opacity-70">Date</dt>
          <dd>
            <CalendarDate value={detail.date} />
          </dd>
        </>
      )}
      {detail.country !== null && (
        <>
          <dt className="opacity-70">Country</dt>
          <dd>{detail.country}</dd>
        </>
      )}
      {detail.takeoff !== null && (
        <>
          <dt className="opacity-70">Takeoff</dt>
          <dd>
            <TakeoffLabel detail={detail} />
          </dd>
        </>
      )}
      {detail.glider !== null && (
        <>
          <dt className="opacity-70">Glider</dt>
          <dd>{detail.glider}</dd>
        </>
      )}
      {detail.duration !== null && (
        <>
          <dt className="opacity-70">Duration</dt>
          <dd>{detail.duration}</dd>
        </>
      )}
      {detail.distanceKm !== null && (
        <>
          <dt className="opacity-70">Distance</dt>
          <dd>{detail.distanceKm} km</dd>
        </>
      )}
      {detail.maxAltitude !== null && (
        <>
          <dt className="opacity-70">Max altitude</dt>
          <dd>{detail.maxAltitude}</dd>
        </>
      )}
      {detail.description !== null && (
        <>
          <dt className="opacity-70">Description</dt>
          <dd className="whitespace-pre-line">{detail.description}</dd>
        </>
      )}
      {detail.takeoffType !== null && (
        <>
          <dt className="opacity-70">Takeoff type</dt>
          <dd>{detail.takeoffType}</dd>
        </>
      )}
    </dl>
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
