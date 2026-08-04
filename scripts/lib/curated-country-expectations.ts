// Check-script-only expectations for the curated datasets identified in
// src/lib/flightlog/curated-countries.ts. Split out from that file (#55): nothing under `src/`
// reads a byte or row-count band — only check-takeoffs-prerender.mts and
// check-clubs-prerender.mts do — so this is check configuration, not a curation decision, and
// grew too large (~45 lines) to keep buried inside the file that decides which ids the app
// itself serves. See docs/testing.md's "Frozen pins vs. live pins" section for the general rule
// this file's bands follow; each export below only carries the reasoning specific to it.
//
// Every artifact these bound is populated by a REAL BUILD fetching flightlog.org LIVE, never
// by fixtures/*.html directly — the fixture only exists to have *once* observed a country's
// shape (field order, a plausible size, a plausible row count) at curation time. A pin between
// two things that both come from the same fixture (check:parsers' hardcoded row counts) is
// stable forever, because both sides move together or not at all. A pin between something
// frozen at curation time and something read off a real build's live fetch is a countdown
// instead: Norway's live counts only grow as pilots log new sites or new clubs form, so an
// exact match against either goes stale the moment either happens (#55).

import type { Range } from './range'

export const TAKEOFF_ROW_COUNT_EXPECTATIONS: readonly {
  countryId: number
  // Floor and ceiling on Norway's live takeoff count. The FLOOR is the one doing real work: it
  // sits close under the observed 6013 (roughly -4.4%, comfortably above the ~5532 an 8%
  // parser-drop would produce) specifically so it still catches a parser or route silently
  // dropping most rows — the job check-takeoffs-prerender.mts's now-deleted total-bytes band
  // used to do, before bytesPerRowRange below took over the shape-guard half of that job. A
  // floor pinned this way never becomes a countdown, unlike a ceiling would: real growth only
  // ever pushes the live count UP, so a floor set once stays valid regardless of how many more
  // takeoffs get logged after it's chosen. The CEILING stays loose (9000, ~+50%) because its
  // job is different — catching a route returning some wildly wrong, unrelated multiple of the
  // real count — not bounding ordinary growth, so it doesn't need to track Norway's pace at all.
  rowCountRange: Range
  // Serialised bytes PER ROW, not total artifact bytes (#55) — total bytes is itself a function
  // of row count, so a band on the total is really two countdowns stacked (it drifts as the row
  // count it depends on drifts, on top of drifting on its own), and the review of this branch
  // measured the drift was real: 405,000-425,000 constrained rows to roughly 5883-6167 while
  // rowCountRange above allowed far more, so the byte band was the only one actually doing work
  // — and it was the one guaranteed to expire, around 6167 rows. Per-row bytes are
  // growth-invariant instead (observed 68.82 for the current shape): serialising more rows
  // doesn't change what one row costs, so this band never needs widening as Norway's dataset
  // grows, only if the wire SHAPE changes (a field added/dropped/resized). Truncated and
  // near-empty artifacts, the failure modes the old total-bytes band also caught, are now
  // caught by rowCountRange's floor plus isTakeoffRows, not by this band.
  bytesPerRowRange: Range
}[] = [{ countryId: 160, rowCountRange: [5750, 9000], bytesPerRowRange: [64, 74] }] // Norway

export const CLUB_ROSTER_EXPECTATIONS: readonly {
  countryId: number
  countryName: string
  // A COUNT OF CLUBS. Exact, not a band — unlike a takeoff (logged by any individual pilot,
  // frequently), a club is an organisation actually forming or dissolving, an event rare enough
  // that this pin is not expected to need touching often. That does not make it not-a-countdown
  // by the rule above (it is still pinned against a real build's live fetch, so it WILL go
  // stale the day a Norwegian club count changes) — it is a deliberate choice to accept a rare,
  // one-line bump over the engineering cost of a band this file's own takeoffs pin needed, not
  // a claim that this pin is somehow exempt from the frozen-vs-live rule. See docs/testing.md's
  // "Frozen pins vs. live pins" section, which lists this as the fourth live-crossing check.
  rowCount: number
  // A coarse sanity band on the rendered HTML PAGE's total byte size — not a field-shape guard,
  // just wide enough (±25% of the observed baseline) to catch the artifact being grossly wrong
  // (truncated, swapped for unrelated content, or missing a whole class of content) while
  // tolerating the page shell's own hashed asset chunk names and whitespace moving between
  // Next.js versions. The country name / club count / row count assertions in
  // check-clubs-prerender.mts are what actually pin correctness; this is a backstop underneath
  // them, not a replacement.
  //
  // Rebaselined by #7's own fix round: each of the 91 club rows gained a real
  // `<a href="/countries/160/clubs/<id>">` link into its own club page (see
  // browse-country-clubs/index.tsx's ClubTable), observed 71,180 bytes after the change — but
  // the FLOOR from the PREVIOUS baseline ([40_000, 66_000], ~53,192 observed pre-#7) was carried
  // over unchanged instead of recomputed from the new number, so it cleared the new baseline by
  // only 0.35% (a band this loose no longer catches the exact regression it exists for: removing
  // every one of those 91 links again rebuilds to 53,188 bytes, which the stale [53_000, 90_000]
  // range would have let straight through). Recomputed here as ±25% of the CURRENT 71,180
  // baseline instead — [53_385, 88_975] — which does catch that specific revert (53,188 falls
  // below the new floor by 197 bytes) without needing to widen the tolerance itself. Expect
  // this pair to move together the next time the page shell changes deliberately: derive both
  // ends from whatever the new observed baseline is, never bump just the ceiling or just carry
  // the old floor forward.
  htmlBytesRange: Range
}[] = [{ countryId: 160, countryName: 'Norway', rowCount: 91, htmlBytesRange: [53_385, 88_975] }]
