'use client'

import Link from 'next/link'
import { useFollowedPilotIds } from '@/lib/follow-store/use-follow-store'
import { usePilotFeedResults, type FlightFeedResults } from './use-flight-feed'
import { FeedEntryRow } from './components/feed-entry-row'
import { countNewEntries, selectFeedPilotIds, type FeedEntry, type PilotFeedFailure } from './feed'

type FlightFeedProps = {
  // Server-only (see lib/flightlog/config.ts), so it arrives as a plain prop from the
  // Server Component page rather than this 'use client' module importing config.ts
  // directly — that import used to compile fine but silently read the browser's env shim,
  // which never carries FLIGHTLOG_PILOT_ID (no NEXT_PUBLIC_ prefix), always falling back to
  // the hardcoded default regardless of what the server actually resolved.
  defaultPilotId: number
}

// The follow list only exists in this browser's localStorage (see follow-store), so the
// feed cannot be rendered on the server: it has nothing to fetch until it hydrates.
export default function FlightFeed({ defaultPilotId }: FlightFeedProps) {
  const { followedIds, hasHydrated } = useFollowedPilotIds()
  return <FlightFeedView hasHydrated={hasHydrated} followedIds={followedIds} defaultPilotId={defaultPilotId} />
}

// Pure aside from the components it composes — no hooks of its own — so it can be rendered
// with react-dom/server against literal props (see check-feed.mts) without a browser. That
// is what actually exercises the hydration guard below: a hook-driven component can't be
// proven to skip rendering real content before hydration without either a browser or
// separating the "what to render" decision (here) from the "read the store" hook (above).
export function FlightFeedView({
  hasHydrated,
  followedIds,
  defaultPilotId,
}: {
  hasHydrated: boolean
  followedIds: ReadonlySet<number>
  defaultPilotId: number
}) {
  if (!hasHydrated) return <FeedSkeleton />

  const { pilotIds, followedCount } = selectFeedPilotIds(followedIds)

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Recent flights</h1>
      {pilotIds.length === 0 ? (
        <>
          <p className="text-sm opacity-70">Flights from pilots you follow show up here.</p>
          <EmptyState defaultPilotId={defaultPilotId} />
        </>
      ) : (
        // Keying by the id set itself gives every genuinely new set of followed pilots a
        // fresh FeedForPilots instance (fresh loading state, fresh results), instead of
        // an effect resetting old state to match the new props — see usePilotFeedResults.
        <FeedForPilots key={pilotIds.join(',')} pilotIds={pilotIds} followedCount={followedCount} />
      )}
    </section>
  )
}

function FeedForPilots({
  pilotIds,
  followedCount,
}: {
  pilotIds: number[]
  followedCount: number | null
}) {
  const results = usePilotFeedResults(pilotIds)
  return <FeedView shownCount={pilotIds.length} followedCount={followedCount} {...results} />
}

// Pure presentation of a resolved (or still-resolving) feed: no hooks, so — like
// FlightFeedView above — it's exercised directly with react-dom/server in check-feed.mts
// against literal FlightFeedResults. That's what gives the failed-pilots notice real
// coverage for "wired to the actual failures, not an empty array": a mistake in feed.ts's
// pure merge/sort/slice logic cannot produce, only a mistake in this wiring can.
export function FeedView({
  shownCount,
  followedCount,
  isLoading,
  entries,
  failedPilots,
}: {
  shownCount: number
  // The real followed total when the list was truncated to fit MAX_PILOTS_PER_FEED, null
  // otherwise — see selectFeedPilotIds. Drives which summary line renders below.
  followedCount: number | null
} & FlightFeedResults) {
  return (
    <>
      <p className="text-sm opacity-70">
        {followedCount === null
          ? `${shownCount} pilot${shownCount === 1 ? '' : 's'} followed`
          : `following ${followedCount} pilots — showing recent flights from the first ${shownCount} to keep this page fast`}
        {isLoading ? ' · loading…' : ''}
      </p>
      <NewSinceLastVisitNotice isLoading={isLoading} entries={entries} />
      <FailedPilotsNotice failures={failedPilots} />
      {entries.length === 0 ? (
        <NoRecentFlights isLoading={isLoading} />
      ) : (
        <FeedTable entries={entries} />
      )}
    </>
  )
}

// A flight with no uploaded GPS track has no `ts` anywhere on flightlog.org, so it cannot be
// checked for newness at all (see FlightNewness's doc comment in feed.ts) — "N new" without
// qualification would silently claim every followed pilot's untracked flights were checked
// too. Shown only once loading settles: a count that includes still-arriving pilots would
// undercount and then jump, which reads as more confusing than informative mid-load.
function NewSinceLastVisitNotice({ isLoading, entries }: { isLoading: boolean; entries: FeedEntry[] }) {
  if (isLoading) return null
  const newCount = countNewEntries(entries)
  return (
    <p className="text-sm opacity-70">
      {newCount} new since your last visit — counted only among flights with a saved GPS track;
      flights without one aren&apos;t checked.
    </p>
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

function EmptyState({ defaultPilotId }: { defaultPilotId: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-black/15 p-6 text-sm opacity-80 dark:border-white/20">
      <p>You are not following any pilots yet.</p>
      <p>
        Open a pilot&apos;s logbook and use the Follow button there to add their flights to this
        feed.
      </p>
      <Link className="underline" href="/pilots/search">
        Search for a pilot by name
      </Link>
      <Link className="underline" href={`/pilots/${defaultPilotId}`}>
        Browse a pilot&apos;s logbook
      </Link>
      <Link className="underline" href="/countries">
        Browse clubs by country
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
