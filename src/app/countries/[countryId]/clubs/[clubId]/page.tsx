import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import BrowseClub from '@/features/browse-club'
import { getClub } from '@/lib/flightlog/club'
import { getClubStats } from '@/lib/flightlog/club-stats'
import { getCountries } from '@/lib/flightlog/countries'
import { parseCanonicalCountryId } from '@/lib/flightlog/country-id'
import { resolveViewerFollowState, toFollowButtonState } from '@/lib/follows/resolve-viewer-follow-state'

type ClubParams = Promise<{ countryId: string; clubId: string }>

// Same canonical-decimal-string + isSafeInteger discipline as parseCanonicalCountryId (see
// country-id.ts's own doc comment for the full reasoning) — clubId gets no CURATION opinion
// (this route accepts every real club id, not just a curated set, see Club's own doc comment
// below), but that is a separate question from whether an alias spelling should be accepted at
// all. `Number(raw)` alone accepts hex (`0x33`), a trailing `.0`, a leading `+`, and
// surrounding whitespace — none of them a spelling any real link in this app emits — and
// `Number.isInteger` alone (rather than `isSafeInteger`) still lets a digit string past
// 2^53-1 silently collapse onto a neighbouring value via float rounding. Each distinct
// spelling of the same id is also a distinct URL, so accepting them multiplies this route's
// own cache entries (both the underlying `'use cache'` data cache, keyed by the parsed number
// either way, and any URL-keyed caching layer in front of it) for no real benefit.
const CANONICAL_DECIMAL_ID = /^(0|[1-9]\d*)$/
function parseCanonicalClubId(raw: string): number | null {
  if (!CANONICAL_DECIMAL_ID.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

export default function ClubPage({ params }: { params: ClubParams }) {
  return (
    <Suspense fallback={<ClubSkeleton />}>
      <Club params={params} />
    </Suspense>
  )
}

// Exported (same reasoning as Clubs/TakeoffDetail's own inner components) so the notFound()
// guards are exercised directly in page.test.tsx without a request context.
//
// Deliberately NOT parseCuratedCountryId: same reasoning as /countries/[countryId]/page.tsx's
// own Clubs component — this page must work for every country the clubs list itself links
// into, not just a curated subset, and the issue this backs explicitly rules out curating
// clubs at all (no curated per-club id list, per-club data drifts too fast to be worth
// prerendering — see getClub's own doc comment).
export async function Club({ params }: { params: ClubParams }) {
  const { countryId: countryIdParam, clubId: clubIdParam } = await params
  const countryId = parseCanonicalCountryId(countryIdParam)
  if (countryId === null || countryId <= 0) notFound()

  const clubId = parseCanonicalClubId(clubIdParam)
  if (clubId === null || clubId <= 0) notFound()

  // Independent fetches, run in parallel: getClub (`a=26`, needs both ids) and getClubStats
  // (`rqtid=1`, needs only `clubId` — see that fetcher's own doc comment on why `country_id`
  // is never sent). A nonexistent club_id still costs one extra `rqtid=1` request rather than
  // a second round trip in the common case, the same tradeoff TakeoffDetail makes for
  // getTakeoffFlights against a possibly-nonexistent start_id.
  const [countries, club, stats] = await Promise.all([getCountries(), getClub(countryId, clubId), getClubStats(clubId)])

  // The one signal that distinguishes "no such club" from "a real club with zero members" —
  // see parseClubDetail's own doc comment on the 0-byte-body signal. `stats` is never used for
  // this: rqtid=1 cannot itself tell a real empty club from a nonexistent one (both render the
  // identical empty table, confirmed byte-identical live), only a=26 can.
  if (club === null) notFound()

  const countryName = countries.find((country) => country.countryId === countryId)?.name ?? `Country ${countryId}`

  // Every stats row that resolves to a userId (see resolve-stats-pilots.ts) does so BY matching
  // against a roster member's own name — its userId is therefore already a member of the
  // roster's own userId set, so the roster alone is a sufficient candidate list for both the
  // roster and the stats leaderboard's follow buttons; no need to fetch stats' own userIds too.
  const candidatePilotIds = club.roster.map((member) => member.userId)
  const { isSignedIn, followedPilotIds } = toFollowButtonState(await resolveViewerFollowState(candidatePilotIds))

  return (
    <BrowseClub
      countryId={countryId}
      countryName={countryName}
      detail={club.detail}
      roster={club.roster}
      stats={stats}
      isSignedIn={isSignedIn}
      followedPilotIds={followedPilotIds}
    />
  )
}

function ClubSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-64 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
