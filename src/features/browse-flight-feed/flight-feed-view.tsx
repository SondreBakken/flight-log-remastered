'use client'

import Link from 'next/link'
import { useEffect, useMemo, type ReactElement } from 'react'
import { pruneSeenTripIdsToFollowedPilots } from '@/lib/seen-trip-store/storage'
import { useFlightFeedResults, type FlightFeedResults } from './use-flight-feed'
import { DiscoveryLinks } from './components/discovery-links'
import { FeedEntryRow } from './components/feed-entry-row'
import {
  countNewEntries,
  selectFeedPilotIds,
  selectFeedTakeoffs,
  type FeedEntry,
  type PilotFeedFailure,
  type TakeoffFeedFailure,
} from './feed'
import { followedPilotIdsOf, followedTakeoffsOf, type ViewerFollowState } from '@/lib/follows/viewer-follow-state'
import type { PilotId, TakeoffRef } from '@/lib/flightlog/types'
import { Callout } from '@/components/callout'
import { EmptyState } from '@/components/empty-state'

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

  // The true, untruncated follow set — useFlightFeedResults only ever sees selectFeedPilotIds's
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
// mapping itself to followedPilotIdsOf and followedTakeoffsOf (see their doc comments) rather than
// re-deriving it with a second switch here — a fourth ViewerFollowState variant fails to compile
// there (their own declared, non-undefined return type leaves no case free to fall through),
// which is what makes this function's own explicit return type below a real, checked guarantee
// rather than a comment. Both return null for exactly the same status.
function FeedBody({ follows, defaultPilotId }: { follows: ViewerFollowState; defaultPilotId: number }): ReactElement {
  const followedPilotIds = followedPilotIdsOf(follows)
  const followedTakeoffs = followedTakeoffsOf(follows)
  if (followedPilotIds === null || followedTakeoffs === null) return <FollowsUnavailableNotice />
  return (
    <FollowedSourcesFeed
      followedPilotIds={followedPilotIds}
      followedTakeoffs={followedTakeoffs}
      defaultPilotId={defaultPilotId}
    />
  )
}

function FollowedSourcesFeed({
  followedPilotIds,
  followedTakeoffs,
  defaultPilotId,
}: {
  followedPilotIds: PilotId[]
  followedTakeoffs: TakeoffRef[]
  defaultPilotId: number
}) {
  const { pilotIds, followedCount } = selectFeedPilotIds(new Set(followedPilotIds))
  const { takeoffs, followedCount: followedTakeoffCount } = selectFeedTakeoffs(followedTakeoffs)

  if (pilotIds.length === 0 && takeoffs.length === 0) {
    return (
      <>
        <p className="text-sm opacity-70">Flights from pilots you follow show up here.</p>
        <NotFollowingAnyoneNotice defaultPilotId={defaultPilotId} />
      </>
    )
  }

  // Keying by the id sets themselves gives every genuinely new set of followed pilots and
  // takeoffs a fresh FeedForSources instance (fresh loading state, fresh results), instead of an
  // effect resetting old state to match the new props — see useFlightFeedResults.
  const key = `${pilotIds.join(',')}|${takeoffs.map((takeoff) => `${takeoff.countryId}/${takeoff.takeoffId}`).join(',')}`
  return (
    <FeedForSources
      key={key}
      pilotIds={pilotIds}
      followedCount={followedCount}
      takeoffs={takeoffs}
      followedTakeoffCount={followedTakeoffCount}
    />
  )
}

// The one visible signal that this feed's own following filter could not be resolved (#155) —
// rendered instead of, not alongside, the ordinary empty state above: "flights from pilots you
// follow show up here" reads as an invitation to go follow someone, which is actively wrong
// advice when the real problem is that the follow list itself failed to load.
function FollowsUnavailableNotice() {
  return (
    <Callout tone="warning">
      <p className="font-medium">Couldn&apos;t load the pilots you follow right now.</p>
      <p className="mt-1 opacity-80">Try reloading the page in a moment.</p>
    </Callout>
  )
}

function FeedForSources({
  pilotIds,
  followedCount,
  takeoffs,
  followedTakeoffCount,
}: {
  pilotIds: number[]
  followedCount: number | null
  takeoffs: TakeoffRef[]
  followedTakeoffCount: number | null
}) {
  const results = useFlightFeedResults(pilotIds, takeoffs)
  return (
    <FeedView
      shownCount={pilotIds.length}
      followedCount={followedCount}
      shownTakeoffCount={takeoffs.length}
      followedTakeoffCount={followedTakeoffCount}
      {...results}
    />
  )
}

// The summary line's two halves, each omitted when that source is not followed at all so a
// pilots-only follower reads exactly as before takeoffs existed.
function summaryParts({
  shownCount,
  followedCount,
  shownTakeoffCount,
  followedTakeoffCount,
}: {
  shownCount: number
  followedCount: number | null
  shownTakeoffCount: number
  followedTakeoffCount: number | null
}): string[] {
  const parts: string[] = []
  if (shownCount > 0) {
    parts.push(
      followedCount === null
        ? `${shownCount} pilot${shownCount === 1 ? '' : 's'} followed`
        : `following ${followedCount} pilots — showing recent flights from the first ${shownCount} to keep this page fast`,
    )
  }
  if (shownTakeoffCount > 0) {
    parts.push(
      followedTakeoffCount === null
        ? `${shownTakeoffCount} takeoff${shownTakeoffCount === 1 ? '' : 's'} followed`
        : `following ${followedTakeoffCount} takeoffs — showing recent flights from the first ${shownTakeoffCount} to keep this page fast`,
    )
  }
  return parts
}

// Pure presentation of a resolved (or still-resolving) feed: no hooks, so it's exercised
// directly with react-dom/server in check-feed.mts against literal FlightFeedResults. That's
// what gives the failed-pilots notice real coverage for "wired to the actual failures, not an
// empty array": a mistake in feed.ts's pure merge/sort/slice logic cannot produce, only a
// mistake in this wiring can.
export function FeedView({
  shownCount,
  followedCount,
  shownTakeoffCount,
  followedTakeoffCount,
  isLoading,
  entries,
  failedPilots,
  failedTakeoffs,
  hasSeenBefore,
}: {
  shownCount: number
  // The real followed total when the list was truncated to fit MAX_PILOTS_PER_FEED, null
  // otherwise — see selectFeedPilotIds. Drives which summary line renders below.
  followedCount: number | null
  // The takeoff twins of the two counts above, see selectFeedTakeoffs.
  shownTakeoffCount: number
  followedTakeoffCount: number | null
} & FlightFeedResults) {
  const summary = summaryParts({ shownCount, followedCount, shownTakeoffCount, followedTakeoffCount })
  return (
    <>
      <p className="text-sm opacity-70">
        {summary.join(' · ')}
        {isLoading ? ' · loading…' : ''}
      </p>
      {/* A takeoff-only follower has no pilot whose "last visit" could be compared against: every
          row is site-sourced and never 'new', so the caption would only say something false. */}
      {shownCount > 0 && (
        <NewSinceLastVisitNotice isLoading={isLoading} entries={entries} hasSeenBefore={hasSeenBefore} />
      )}
      <FailedPilotsNotice failures={failedPilots} />
      <FailedTakeoffsNotice failures={failedTakeoffs} />
      {entries.length === 0 ? (
        <NoRecentFlights isLoading={isLoading} followsPilots={shownCount > 0} followsTakeoffs={shownTakeoffCount > 0} />
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
    <Callout tone="warning">
      <p className="font-medium">Some followed pilots could not be loaded:</p>
      <ul className="mt-1 list-inside list-disc opacity-80">
        {failures.map((failure) => (
          <li key={failure.pilotId}>
            <Link href={`/pilots/${failure.pilotId}`}>
              Pilot {failure.pilotId}
            </Link>{' '}
            — {failure.message}
          </li>
        ))}
      </ul>
    </Callout>
  )
}

function FailedTakeoffsNotice({ failures }: { failures: TakeoffFeedFailure[] }) {
  if (failures.length === 0) return null

  return (
    <Callout tone="warning">
      <p className="font-medium">Some followed takeoffs could not be loaded:</p>
      <ul className="mt-1 list-inside list-disc opacity-80">
        {failures.map((failure) => (
          <li key={`${failure.countryId}-${failure.takeoffId}`}>
            <Link href={`/countries/${failure.countryId}/takeoffs/${failure.takeoffId}`}>
              Takeoff {failure.takeoffId}
            </Link>{' '}
            — {failure.message}
          </li>
        ))}
      </ul>
    </Callout>
  )
}

function NotFollowingAnyoneNotice({ defaultPilotId }: { defaultPilotId: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-black/15 p-6 text-sm opacity-80 dark:border-white/20">
      <p>You are not following any pilots yet.</p>
      <p>
        Open a pilot&apos;s logbook and use the Follow button there to add their flights to this
        feed. Following a takeoff from its page adds the flights flown from it.
      </p>
      <DiscoveryLinks defaultPilotId={defaultPilotId} />
    </div>
  )
}

function NoRecentFlights({
  isLoading,
  followsPilots,
  followsTakeoffs,
}: {
  isLoading: boolean
  followsPilots: boolean
  followsTakeoffs: boolean
}) {
  const sources = [followsPilots && 'pilots', followsTakeoffs && 'takeoffs'].filter(Boolean).join(' and ')
  return <EmptyState>{isLoading ? 'Loading recent flights…' : `No recent flights from the ${sources} you follow.`}</EmptyState>
}

function FeedTable({ entries }: { entries: FeedEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="py-2 pr-4 form-label">Date</th>
            <th className="py-2 pr-4 form-label">Pilot</th>
            <th className="py-2 pr-4 form-label">Site</th>
            <th className="py-2 pr-4 text-right form-label">Time</th>
            <th className="py-2 pr-4 text-right form-label">Distance</th>
            <th className="py-2 form-label">Track</th>
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
