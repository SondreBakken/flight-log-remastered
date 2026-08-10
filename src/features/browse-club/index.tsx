import Link from 'next/link'
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
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Pilot stats</h2>
        <StatsLeaderboard stats={resolvedStats} isSignedIn={isSignedIn} followedPilotIds={followedPilotIds} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Members ({roster.length})</h2>
        <Roster roster={roster} isSignedIn={isSignedIn} followedPilotIds={followedPilotIdSet} />
      </div>
      <Link className="text-sm underline underline-offset-2" href={`/countries/${countryId}`}>
        Back to {countryName} clubs
      </Link>
    </section>
  )
}

function ClubHeader({ countryId, countryName, detail }: { countryId: number; countryName: string; detail: ClubDetail }) {
  return (
    <header className="flex flex-col gap-2">
      <Link className="text-sm underline underline-offset-2" href={`/countries/${countryId}`}>
        {countryName}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="opacity-70">Members</dt>
        <dd>{detail.memberCount}</dd>
        {detail.description !== null && (
          <>
            <dt className="opacity-70">Description</dt>
            <dd className="whitespace-pre-line">{detail.description}</dd>
          </>
        )}
        {detail.coordinatesText !== null && (
          <>
            <dt className="opacity-70">Coordinates</dt>
            <dd className="whitespace-pre-line">
              {detail.coordinatesText}
              {detail.mapUrl !== null && (
                <>
                  {' '}
                  <a className="underline underline-offset-2" href={detail.mapUrl} target="_blank" rel="noreferrer">
                    View on map
                  </a>
                </>
              )}
            </dd>
          </>
        )}
        {detail.linkUrl !== null && (
          <>
            <dt className="opacity-70">Link</dt>
            <dd>
              <a className="underline underline-offset-2" href={detail.linkUrl} target="_blank" rel="noreferrer">
                {detail.linkUrl}
              </a>
            </dd>
          </>
        )}
        {detail.createdAt !== null && (
          <>
            <dt className="opacity-70">Created</dt>
            <dd>{detail.createdAt}</dd>
          </>
        )}
        {detail.updatedAt !== null && (
          <>
            <dt className="opacity-70">Updated</dt>
            <dd>{detail.updatedAt}</dd>
          </>
        )}
      </dl>
    </header>
  )
}

// Every roster member gets a follow button unconditionally — unlike a stats row (see
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
    return (
      <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
        No members recorded for this club yet.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
      {roster.map((member) => (
        <li key={member.userId} className="flex items-center justify-between gap-4 py-2 text-sm">
          <Link className="underline underline-offset-2" href={`/pilots/${member.userId}`}>
            {member.name}
          </Link>
          <FollowButton
            isFollowed={followedPilotIds.has(member.userId)}
            isSignedIn={isSignedIn}
            pilotId={member.userId}
            variant="compact"
          />
        </li>
      ))}
    </ul>
  )
}
