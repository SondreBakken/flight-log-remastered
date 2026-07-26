import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import FlightTrack from '@/features/show-flight-track'
import { flightlogFlightUrl } from '@/lib/flightlog/config'
import { getTrack } from '@/lib/flightlog/tracks'

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

async function Flight({ params }: { params: FlightParams }) {
  const { tripId } = await params
  const id = Number(tripId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const track = await getTrack(id)

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
      <FlightTrack track={track} />
    </>
  )
}

function FlightSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-[70vh] w-full animate-pulse rounded-md bg-black/5 dark:bg-white/5" />
    </div>
  )
}
