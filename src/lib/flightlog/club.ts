import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parseClubDetail } from './parse-club-detail'
import { parseClubRoster } from './parse-club-roster'
import type { ClubDetail, ClubMember } from './types'

const CLUB_DETAIL = 26
// The real page a browser lands on right before opening a specific club's detail (see
// getTakeoffDetail's identical reasoning for `a=22`'s own referer) — a=25 is "Clubs in a
// country", confirmed by every sampled club fixture's own breadcrumb.
const CLUBS_IN_COUNTRY = 25

// Not named `Club` — that name is already `types.ts`'s clubId/name/flightCount summary row
// from the clubs-LIST endpoint (`a=25`), imported all over the clubs-list feature; reusing it
// here for a structurally unrelated shape would be a same-name, different-meaning collision.
export type ClubWithRoster = {
  detail: ClubDetail
  roster: ClubMember[]
}

// One `a=26` fetch backs both the info block and the full member roster — they render on the
// same response (see docs/flightlog-api.md and parse-club-detail.ts/parse-club-roster.ts),
// so there is no second request to make here the way getTakeoffDetail/getTakeoffFlights need
// two (`a=22` and `a=42` are genuinely different pages).
//
// `null` means "flightlog.org has no club at this id" (parseClubDetail's own 0-byte-body
// signal, see that file's doc comment) — the page.tsx caller turns that into notFound(), the
// same split getTakeoffDetail's own null return backs.
//
// Deliberately NOT cached at build time (see curated-countries.ts and the issue this backs):
// per-club member counts drift far faster than the country-level club COUNT does, there is no
// curated per-club id list, and prerendering one would multiply the "flightlog.org outage
// fails the deploy" risk per club rather than per country. `'use cache'` here still gets this
// per-REQUEST caching (see cacheLife), just never at build time — nothing calls this from
// generateStaticParams.
export async function getClub(countryId: number, clubId: number): Promise<ClubWithRoster | null> {
  'use cache'
  cacheLife('hours')
  cacheTag(`club-${countryId}-${clubId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${CLUB_DETAIL}&country_id=${countryId}&club_id=${clubId}`,
    { referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${CLUBS_IN_COUNTRY}&country_id=${countryId}` },
  )

  const detail = parseClubDetail(html, clubId)
  if (detail === null) return null

  const roster = parseClubRoster(html, clubId)

  // The info block sits near the top of the response and the roster runs to the bottom (Voss:
  // 1271 rows) — an upstream truncation mid-render (a fatal or timeout partway through a
  // legacy page emitting hundreds or thousands of rows) produces a complete HTTP response
  // carrying a fully-formed info block beside a partial roster, and neither parser can catch
  // this on its own: parseClubRoster's own floor check only compares parsed-vs-candidate rows
  // WITHIN whatever markup survived, so a body cut off after row 100 of 1271 still parses those
  // 100 rows cleanly and returns them. `detail.memberCount` is the one number on this page that
  // both halves of the response independently agree on when nothing was cut — enforcing it here
  // is what actually closes the gap, the same floor-check discipline every parser in this file
  // family applies within its own table, just applied across the two tables instead of within
  // one.
  if (roster.length !== detail.memberCount) {
    throw new Error(
      `Club ${clubId}: roster carries ${roster.length} member(s) but the info block declares ${detail.memberCount} — the response is likely truncated`,
    )
  }

  return { detail, roster }
}
