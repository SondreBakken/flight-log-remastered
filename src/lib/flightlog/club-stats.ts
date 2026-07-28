import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseClubStats } from './parse-club-stats'
import type { ClubPilotStats } from './types'

const CLUB_STATS = 1

// `clubId: number` — required, no default, not folded into an options bag a caller could
// build without it. Measured live: `rqtid=1` omitting `club_id` does not error, it silently
// returns 146 rows belonging to a completely different club (see docs/flightlog-api.md). This
// required signature is the actual guard against that mistake — pinned by club-stats.test.ts's
// exact-URL assertion, not by parse-club-stats.ts's own `clubId` parameter, which is used only
// to label that file's error messages (see its own doc comment). `country_id` is NOT sent here
// at all — confirmed live byte-identical to the same request WITH a `country_id`, so it is
// decorative for this endpoint and adding it would only invite a future caller to mistake it
// for the real key.
export async function getClubStats(clubId: number): Promise<ClubPilotStats[]> {
  'use cache'
  cacheLife('hours')
  cacheTag(`club-stats-${clubId}`)

  const html = await fetchFlightlogText(`/fl.html?rqtid=${CLUB_STATS}&club_id=${clubId}`, {
    // A raw data resource nothing on flightlog.org itself links to — same no-natural-referrer
    // reasoning as getTakeoffs/getRegions/getCountries.
    referer: FLIGHTLOG_ORIGIN,
  })
  return parseClubStats(html, clubId)
}
