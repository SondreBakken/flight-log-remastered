import Link from 'next/link'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { CalendarDate } from '@/components/calendar-date'
import { EmptyState } from '@/components/empty-state'
import { FollowButton } from '@/components/follow-button'
import { StatsLeaderboard } from './stats-leaderboard'
import { resolveStatsPilots } from './resolve-stats-pilots'
import type { ClubDetail, ClubMember, ClubPilotStats, PilotId } from '@/lib/flightlog/types'

type BrowseClubProps = {
  countryId: number
  countryName: string
  detail: ClubDetail
  roster: ClubMember[]
  stats: ClubPilotStats[]
  // Resolved once server-side by the page (see resolve-viewer-follow-state.ts), scoped to this
  // roster's own userIds — never re-derived here, and never a per-button client-side auth
  // subscription (see FollowButton's own doc comment).
  isSignedIn: boolean
  followedPilotIds: PilotId[]
}

// The roster (every member, flown or not — see resolve-stats-pilots.ts's own doc comment on
// why the join must not be read the other way round) and the stats leaderboard (only pilots
// with at least one recorded flight) are two different views over the same club, not one
// merged table — Voss alone is 1271 members against 290 with any flights, and folding the
// second into the first would either drop 981 never-flown members or pad the leaderboard with
// a thousand rows of zeroes nobody asked to sort by.
export default function BrowseClub({
  countryId,
  countryName,
  detail,
  roster,
  stats,
  isSignedIn,
  followedPilotIds,
}: BrowseClubProps) {
  const resolvedStats = resolveStatsPilots(roster, stats)
  const followedPilotIdSet = new Set(followedPilotIds)

  return (
    <section className="flex flex-col gap-8">
      <ClubHeader countryId={countryId} countryName={countryName} detail={detail} />
      {!isSignedIn && roster.length > 0 && <SignInPrompt />}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Pilot stats</h2>
        <StatsLeaderboard stats={resolvedStats} isSignedIn={isSignedIn} followedPilotIds={followedPilotIds} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Members ({roster.length})</h2>
        <Roster roster={roster} isSignedIn={isSignedIn} followedPilotIds={followedPilotIdSet} />
      </div>
      <Link className="flex w-fit items-center gap-1 text-sm" href={`/countries/${countryId}`}>
        <ChevronLeft aria-hidden="true" size={14} />
        Back to {countryName} clubs
      </Link>
    </section>
  )
}

function ClubHeader({ countryId, countryName, detail }: { countryId: number; countryName: string; detail: ClubDetail }) {
  return (
    <header className="flex flex-col gap-2">
      <Link className="text-sm" href={`/countries/${countryId}`}>
        {countryName}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col">
          <dt className="form-label">Members</dt>
          <dd>{detail.memberCount}</dd>
        </div>
        {detail.description !== null && (
          <div className="flex flex-col">
            <dt className="form-label">Description</dt>
            <dd className="whitespace-pre-line">{detail.description}</dd>
          </div>
        )}
        {detail.coordinatesText !== null && (
          <div className="flex flex-col">
            <dt className="form-label">Coordinates</dt>
            <dd className="whitespace-pre-line">
              {detail.coordinatesText}
              {detail.mapUrl !== null && (
                <>
                  {' '}
                  <a className="inline-flex items-center gap-1" href={detail.mapUrl} target="_blank" rel="noreferrer">
                    View on map
                    <ExternalLink aria-hidden="true" size={14} />
                  </a>
                </>
              )}
            </dd>
          </div>
        )}
        {detail.linkUrl !== null && (
          <div className="flex flex-col">
            <dt className="form-label">Link</dt>
            <dd>
              <a href={detail.linkUrl} target="_blank" rel="noreferrer">
                {detail.linkUrl}
              </a>
            </dd>
          </div>
        )}
        {detail.createdAt !== null && (
          <div className="flex flex-col">
            <dt className="form-label">Created</dt>
            <dd>
              <CalendarDate value={detail.createdAt} />
            </dd>
          </div>
        )}
        {detail.updatedAt !== null && (
          <div className="flex flex-col">
            <dt className="form-label">Updated</dt>
            <dd>
              <CalendarDate value={detail.updatedAt} />
            </dd>
          </div>
        )}
      </dl>
    </header>
  )
}

// One prompt for both lists, so a signed-out page does not repeat the same link on every row.
function SignInPrompt() {
  return (
    <Link className="w-fit text-sm" href="/sign-in">
      Sign in to follow pilots
    </Link>
  )
}

// Every roster member gets a follow button when signed in, unlike a stats row (see
// stats-leaderboard.tsx), a roster row already carries its own `user_id` straight from
// flightlog.org, nothing to resolve or fail to resolve.
function Roster({
  roster,
  isSignedIn,
  followedPilotIds,
}: {
  roster: ClubMember[]
  isSignedIn: boolean
  followedPilotIds: ReadonlySet<PilotId>
}) {
  if (roster.length === 0) {
    return <EmptyState>No members recorded for this club yet.</EmptyState>
  }

  return (
    <ul className="flex flex-col divide-y divide-rule">
      {roster.map((member) => (
        <li key={member.userId} className="flex items-center justify-between gap-4 py-2 text-sm">
          <Link href={`/pilots/${member.userId}`}>
            {member.name}
          </Link>
          {isSignedIn && (
            <FollowButton isFollowed={followedPilotIds.has(member.userId)} isSignedIn pilotId={member.userId} variant="compact" />
          )}
        </li>
      ))}
    </ul>
  )
}
