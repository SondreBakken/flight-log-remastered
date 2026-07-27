'use client'

import Link from 'next/link'
import { DEFAULT_PILOT_ID } from '@/lib/flightlog/config'
import { useFollowedPilotIds } from '@/lib/follow-store/use-follow-store'
import { usePilotFeedResults } from './use-flight-feed'
import { FeedEntryRow } from './components/feed-entry-row'
import type { FeedEntry, PilotFeedFailure } from './feed'

// The follow list only exists in this browser's localStorage (see follow-store), so the
// feed cannot be rendered on the server: it has nothing to fetch until it hydrates.
export default function FlightFeed() {
  const { followedIds, hasHydrated } = useFollowedPilotIds()

  if (!hasHydrated) return <FeedSkeleton />

  const pilotIds = [...followedIds].sort((a, b) => a - b)

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Recent flights</h1>
      {pilotIds.length === 0 ? (
        <>
          <p className="text-sm opacity-70">Flights from pilots you follow show up here.</p>
          <EmptyState />
        </>
      ) : (
        // Keying by the id set itself gives every genuinely new set of followed pilots a
        // fresh FeedForPilots instance (fresh loading state, fresh results), instead of
        // an effect resetting old state to match the new props — see usePilotFeedResults.
        <FeedForPilots key={pilotIds.join(',')} pilotIds={pilotIds} />
      )}
    </section>
  )
}

function FeedForPilots({ pilotIds }: { pilotIds: number[] }) {
  const { isLoading, entries, failedPilots } = usePilotFeedResults(pilotIds)

  return (
    <>
      <p className="text-sm opacity-70">
        {pilotIds.length} pilot{pilotIds.length === 1 ? '' : 's'} followed
        {isLoading ? ' · loading…' : ''}
      </p>
      <FailedPilotsNotice failures={failedPilots} />
      {entries.length === 0 ? (
        <NoRecentFlights isLoading={isLoading} />
      ) : (
        <FeedTable entries={entries} />
      )}
    </>
  )
}

function FailedPilotsNotice({ failures }: { failures: PilotFeedFailure[] }) {
  if (failures.length === 0) return null

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Some followed pilots could not be loaded:</p>
      <ul className="mt-1 list-inside list-disc opacity-80">
        {failures.map((failure) => (
          <li key={failure.pilotId}>
            <Link className="underline" href={`/pilots/${failure.pilotId}`}>
              Pilot {failure.pilotId}
            </Link>{' '}
            — {failure.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-black/15 p-6 text-sm opacity-80 dark:border-white/20">
      <p>You are not following any pilots yet.</p>
      <p>
        Open a pilot&apos;s logbook and use the Follow button there to add their flights to this
        feed.
      </p>
      <Link className="underline" href={`/pilots/${DEFAULT_PILOT_ID}`}>
        Browse a pilot&apos;s logbook
      </Link>
    </div>
  )
}

function NoRecentFlights({ isLoading }: { isLoading: boolean }) {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      {isLoading ? 'Loading recent flights…' : 'No recent flights from the pilots you follow.'}
    </p>
  )
}

function FeedTable({ entries }: { entries: FeedEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Pilot</th>
            <th className="py-2 pr-4 font-medium">Site</th>
            <th className="py-2 pr-4 text-right font-medium">Time</th>
            <th className="py-2 pr-4 text-right font-medium">Distance</th>
            <th className="py-2 font-medium">Track</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <FeedEntryRow key={`${entry.pilot.userId}-${entry.flight.tripId}`} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-72 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
