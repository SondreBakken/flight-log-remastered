'use client'

import Link from 'next/link'
import { useEffect, useMemo, type ReactElement } from 'react'
import { pruneSeenTripIdsToFollowedPilots } from '@/lib/seen-trip-store/storage'
import { usePilotFeedResults, type FlightFeedResults } from './use-flight-feed'
import { FeedEntryRow } from './components/feed-entry-row'
import { countNewEntries, selectFeedPilotIds, type FeedEntry, type PilotFeedFailure } from './feed'
import { followedPilotIdsOf, type ViewerFollowState } from '@/lib/follows/viewer-follow-state'
import type { PilotId } from '@/lib/flightlog/types'

// follows now arrives as a server-resolved prop (see index.tsx's own doc comment) — known before
// the very first render, unlike the old localStorage-backed version, which had to render a
// hydration skeleton until the browser's own store caught up. No hasHydrated left to gate on.
//
// Required, not defaulted (unlike the old followedPilotIds/followsUnavailable pair) — every call
// site, including this file's own index.test.tsx, must now say explicitly which ViewerFollowState
// status it means, rather than a missing prop silently reading as "resolved, follows nobody".
export function FlightFeedView({
  follows,
  defaultPilotId,
}: {
  follows: ViewerFollowState
  defaultPilotId: number
}) {
  // null specifically for 'follows-unavailable' (see followedPilotIdsOf): the true, untruncated
  // follow set is not known, so there is nothing safe to prune seen-trip-store's stored map down
  // to (see the effect below). 'signed-out' resolves to a real, genuine empty Set — that status
  // IS a resolved follow list, not a failure.
  const followedIds = useMemo(() => {
    const followedPilotIds = followedPilotIdsOf(follows)
    return followedPilotIds === null ? null : new Set(followedPilotIds)
  }, [follows])

  // The true, untruncated follow set — usePilotFeedResults only ever sees selectFeedPilotIds's
  // MAX_PILOTS_PER_FEED-truncated subset below, which is not enough to safely prune
  // seen-trip-store's stored map (see pruneSeenTripIdsToFollowedPilots's own doc comment for the
  // accumulation bug this closes). Runs whenever the resolved follow set changes (a fresh page
  // load after following/unfollowing elsewhere), not on a mount-only basis, so falling out of
  // the top MAX_PILOTS_PER_FEED stays pruned over time; unfollowing itself is already handled
  // explicitly by FollowButton's own clearSeenTripIds call. Skipped entirely while followedIds is
  // null (follows-unavailable) — pruning against an empty stand-in here is what used to wipe the
  // whole seen-trip store on a mere query failure (#155 follow-up).
  useEffect(() => {
    if (followedIds === null) return
    pruneSeenTripIdsToFollowedPilots(followedIds)
  }, [followedIds])

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Recent flights</h1>
      <FeedBody follows={follows} defaultPilotId={defaultPilotId} />
    </section>
  )
}

// The three states FlightFeedView can render, named and matched explicitly rather than picked
// between with nested ternaries in the render body above. Delegates the status → follow-list
// mapping itself to followedPilotIdsOf (see its own doc comment) rather than re-deriving it with
// a second switch here — a fourth ViewerFollowState variant fails to compile there (its own
// declared, non-undefined return type leaves no case free to fall through), which is what makes
// this function's own explicit return type below a real, checked guarantee rather than a comment.
function FeedBody({ follows, defaultPilotId }: { follows: ViewerFollowState; defaultPilotId: number }): ReactElement {
  const followedPilotIds = followedPilotIdsOf(follows)
  if (followedPilotIds === null) return <FollowsUnavailableNotice />
  return <FollowedPilotsFeed followedPilotIds={followedPilotIds} defaultPilotId={defaultPilotId} />
}

function FollowedPilotsFeed({ followedPilotIds, defaultPilotId }: { followedPilotIds: PilotId[]; defaultPilotId: number }) {
  const { pilotIds, followedCount } = selectFeedPilotIds(new Set(followedPilotIds))

  if (pilotIds.length === 0) {
    return (
      <>
        <p className="text-sm opacity-70">Flights from pilots you follow show up here.</p>
        <EmptyState defaultPilotId={defaultPilotId} />
      </>
    )
  }

  // Keying by the id set itself gives every genuinely new set of followed pilots a fresh
  // FeedForPilots instance (fresh loading state, fresh results), instead of an effect resetting
  // old state to match the new props — see usePilotFeedResults.
  return <FeedForPilots key={pilotIds.join(',')} pilotIds={pilotIds} followedCount={followedCount} />
}

// The one visible signal that this feed's own following filter could not be resolved (#155) —
// rendered instead of, not alongside, the ordinary empty state above: "flights from pilots you
// follow show up here" reads as an invitation to go follow someone, which is actively wrong
// advice when the real problem is that the follow list itself failed to load.
function FollowsUnavailableNotice() {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Couldn&apos;t load the pilots you follow right now.</p>
      <p className="mt-1 opacity-80">Try reloading the page in a moment.</p>
    </div>
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

// Pure presentation of a resolved (or still-resolving) feed: no hooks, so it's exercised
// directly with react-dom/server in check-feed.mts against literal FlightFeedResults. That's
// what gives the failed-pilots notice real coverage for "wired to the actual failures, not an
// empty array": a mistake in feed.ts's pure merge/sort/slice logic cannot produce, only a
// mistake in this wiring can.
export function FeedView({
  shownCount,
  followedCount,
  isLoading,
  entries,
  failedPilots,
  hasSeenBefore,
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
      <NewSinceLastVisitNotice isLoading={isLoading} entries={entries} hasSeenBefore={hasSeenBefore} />
      <FailedPilotsNotice failures={failedPilots} />
      {entries.length === 0 ? (
        <NoRecentFlights isLoading={isLoading} />
      ) : (
        <FeedTable entries={entries} />
      )}
    </>
  )
}

// Untracked flights are checked for newness too now (#62, via seen-trip-store), so "N new"
// covers every followed pilot's flights, tracked or not — the caption used to carve out an
// explicit "counted only among flights with a saved GPS track" caveat; that caveat is gone
// because it would now be false. Shown only once loading settles: a count that includes
// still-arriving pilots would undercount and then jump, which reads as more confusing than
// informative mid-load.
//
// Two states this used to get wrong, both now handled explicitly rather than left as permanent
// furniture: a genuine first-time visitor has no "last visit" to report a count against, however
// many flights classifyTrackedNewness/classifyUntrackedNewness read as 'new' by construction of
// their null-signal case — see hasSeenBefore/anyPilotHasPriorVisit. And a count of zero isn't
// worth a permanent line of UI once there IS a real last visit to compare against — it renders
// nothing rather than "0 new" every time nothing changed. (`newCount` here is scoped to the top
// FEED_SIZE shown entries, per countNewEntries's own doc comment, so pilots truncated out of the
// merge — see MAX_PILOTS_PER_FEED — or their flights truncated out by FEED_SIZE, are not
// represented in it; the adjacent failed-pilots notice partly mitigates the failed-to-load case,
// but truncation itself has no notice.)
function NewSinceLastVisitNotice({
  isLoading,
  entries,
  hasSeenBefore,
}: {
  isLoading: boolean
  entries: FeedEntry[]
  hasSeenBefore: boolean
}) {
  if (isLoading) return null
  if (!hasSeenBefore) {
    // Every flight below genuinely reads 'new' right now (classifyTrackedNewness/
    // classifyUntrackedNewness's null-signal default, since no watermark or seen-trip entry
    // exists for any followed pilot yet) — the "New" badges ARE showing. This caption used to
    // claim the opposite ("nothing is marked new yet"), which was false the moment #62 gave
    // untracked flights the same default (worst for an all-untracked pilot, previously the one
    // case where that claim was actually true). Describe what's really on screen instead.
    return (
      <p className="text-sm opacity-70">
        This is the first time your followed pilots&apos; flights have been checked, so everything
        below is shown as new; a real &quot;since your last visit&quot; comparison starts from here.
      </p>
    )
  }
  const newCount = countNewEntries(entries)
  if (newCount === 0) return null
  return <p className="text-sm opacity-70">{newCount} new since your last visit</p>
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
