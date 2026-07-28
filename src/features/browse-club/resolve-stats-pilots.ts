import type { ClubMember, ClubPilotStats } from '@/lib/flightlog/types'

// `rqtid=1` carries no `user_id`, only a display name (see docs/flightlog-api.md's "THE
// JOIN") — `userId` here is the RESULT of resolving that name against the roster, never
// something the stats endpoint itself provides. `null` is a real, distinct outcome (zero or
// more-than-one roster match), not "not yet resolved" — a caller must render it as "no link
// available", never as a confident answer it doesn't have. This repo has shipped that exact
// confident-wrong-answer failure five times before (#25, #6, #32, #8, #59); this type exists
// so a fifth attempt at the same mistake, specifically for club stats, is a type error instead
// of a runtime one.
export type ResolvedClubStats = ClubPilotStats & { userId: number | null }

// Both `ClubMember.name` and `ClubPilotStats.name` are already the output of cheerio's own
// `.text()` on their respective source pages (parse-club-roster.ts, parse-club-stats.ts) —
// htmlparser2 decodes HTML entities (`&#039;` -> `'`) while parsing text nodes, so by the
// time either name reaches this file the "&#039; vs a literal apostrophe" mismatch that
// motivated the "decode before comparing" rule can no longer occur; comparing the parsed
// strings directly (verbatim, no further normalisation) IS decode-then-compare. Confirmed
// live against Voss's own fixture (`fixtures/a26-51-club.html`'s roster spells "Luis
// &#039;&#039;Mickey&#039;&#039; Fonseca", `fixtures/rqtid1-51.html`'s stats table spells the
// same pilot "Luis ''Mickey'' Fonseca" verbatim — both parse to the identical string).
function buildNameIndex(roster: ClubMember[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (const member of roster) {
    const ids = index.get(member.name) ?? []
    ids.push(member.userId)
    index.set(member.name, ids)
  }
  return index
}

// The join is FROM the roster (built as the lookup index below), never from stats — the
// roster is the club's real member list (Voss: 1271, only 290 of whom have ever flown), and
// nothing here drops a never-flown member the way starting from stats would (stats has no row
// for them at all). This function's own job is narrower than that framing suggests, though:
// it only ANNOTATES each stats row with a `userId` where the roster resolves it unambiguously
// — rendering the roster itself (every member, flown or not) is the caller's job, using
// `ClubMember[]` directly, not this function's output.
//
// Do not fuzzy-match, do not guess, do not silently pick the first id on a multi-match — a
// name shared by two roster members (Voss has 6 real collisions: "Cato Wiese-Hansen" is
// exactly one stats row against two distinct `user_id`s, 5286 and 11085, with nothing in
// either response to say which one actually flew) resolves to `userId: null`, on purpose,
// not to whichever id happened to be pushed into the index first.
export function resolveStatsPilots(roster: ClubMember[], stats: ClubPilotStats[]): ResolvedClubStats[] {
  const nameIndex = buildNameIndex(roster)
  return stats.map((row) => {
    const matches = nameIndex.get(row.name) ?? []
    return { ...row, userId: matches.length === 1 ? matches[0] : null }
  })
}

export type ClubStatsSortKey = 'flights' | 'distanceKm' | 'hours'
export type SortDirection = 'asc' | 'desc'

// A new array, never sorted in place — `stats` is a caller-owned prop/state value in every
// call site this file has (the leaderboard component's own state), and mutating a prop array
// in place is the kind of bug that only shows up as a confusing re-render later.
export function sortResolvedStats(stats: ResolvedClubStats[], key: ClubStatsSortKey, direction: SortDirection): ResolvedClubStats[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...stats].sort((a, b) => (a[key] - b[key]) * sign)
}
