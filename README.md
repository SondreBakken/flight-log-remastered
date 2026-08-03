# Flight Log Remastered

A spike: a modern frontend reading live data from [flightlog.org](https://flightlog.org), which has no
official API. Next.js 16 App Router, React 19, MapLibre.

**Live:** https://flight-log-remastered.vercel.app

Deployed on Vercel with `vercel deploy --prod`. Vercel's datacenter IPs are not blocked by
flightlog.org's WAF, so the deployed app reads live data with no proxy in between. Deployment
Protection is off so the site is publicly viewable.

```bash
pnpm dev            # http://localhost:3000
pnpm build && pnpm start
pnpm run check                            # every check: below, in one pass
pnpm run check:parsers                    # parsers against saved fixtures; SKIPs (exit 0) if fixtures/ is absent
pnpm run check:takeoffs-prerender         # takeoffs API route is prerendered at build time; needs a fresh `pnpm run build`
pnpm run check:clubs-prerender            # clubs page is prerendered for the curated set at build time; needs a fresh `pnpm run build`
pnpm run check:barogram                   # barogram downsampling and scaling math
pnpm run check:track-gradient             # altitude colour ramp and gradient-stop distance math
pnpm run check:track-hover                # map/chart hover identity (shared index, not seconds)
pnpm run check:scoring                    # scoring-overlay geometries against saved KML fixtures; SKIPs (exit 0) if fixtures/ is absent
pnpm run check:follow-store               # followed-pilots store, pure core + storage adapter
pnpm run check:follow-button              # follow button presentation (label, aria-pressed, classes)
pnpm run check:feed                       # recent-flights feed: merge/sort/slice, year derivation, concurrency cap
pnpm run check:watermark-store            # per-pilot "new since last visit" watermark, pure core + storage adapter
pnpm run check:seen-trip-store            # per-pilot remembered UNTRACKED trip ids, pure core + storage adapter
pnpm run check:request-gate               # outbound request gate: concurrency cap, in-flight tracking
pnpm test                                 # Vitest: components, jsdom + React Testing Library
pnpm lint                                 # ESLint
pnpm exec tsx scripts/shot.mts <url> <out.png>
pnpm exec tsx scripts/verify-shot.mts                     # pixel-level proof shot.mts's capture isn't blank (#21); see note below
```

`pnpm run check` is mostly pure, source-only logic — plus, as its last step, `pnpm test` — **with two
exceptions**: `check:takeoffs-prerender` and `check:clubs-prerender` both read
`.next/prerender-manifest.json` and need a local `pnpm run build` to exist and be currently up to
date with the working tree first (each compares mtimes and FAILs, rather than silently skipping or
passing, if the build is missing or stale — see `scripts/lib/prerender-manifest-check.ts`, shared by
both). Run `pnpm run build` before `pnpm run check` if you've touched anything under `src/` since
your last build.

**Frozen pins vs. live pins.** Several checks pin a number derived from `fixtures/takeoffs-160.html`
at the time it was scraped. Whether that pin stays exact or needs to tolerate a range depends on
what it's compared against, not on where the number came from. A pin between two things that both
come from the same fixture (`check:parsers`' hardcoded row counts, for example) is stable forever:
both sides are frozen at the same curation time, so they move together or not at all. A pin between
something frozen at curation time and something read off a REAL BUILD's LIVE fetch of
flightlog.org is a countdown instead, and it goes stale the moment the live number it's compared
against changes, on flightlog.org's own schedule, not one this repo controls. Five checks cross
that boundary today:

- `check:takeoffs-prerender` pins Norway's live takeoff count and its serialised artifact shape,
  both as bands (#55), not exact counts. `rowCountRange`'s floor sits close under the observed
  count, specifically so it still catches a parser silently dropping most rows; its ceiling stays
  loose, because its job is catching a route returning some wildly wrong multiple, not bounding
  ordinary growth. `bytesPerRowRange` bounds serialised bytes PER ROW rather than total artifact
  bytes, which makes it growth-invariant instead of a second countdown stacked on the first one
  (an earlier version of this band, on total bytes, was found to expire around 6167 rows despite
  a comment claiming it was "years" from doing so). See `scripts/lib/curated-country-expectations.ts`
  for the exact numbers and reasoning behind each.
- `verify-takeoffs.mts` shares that same row-count band (imported, not copy-pasted three times),
  plus a wind-direction check that carries #49's original guarantee without a hand-measured band
  at all: it opens the shareable `?wind=` link for three real octants (N, a near neighbour, and a
  far one) and asserts their totals differ from each other. A filter broken the same way on every
  request (exactly #49's own mutation, and #55's own regression test) cannot fake three different
  octants producing three different totals, the way it could fake landing inside an absolute band
  picked around one octant's own count.
- `verify-sites-map.mts` shares the same row-count band, asserted against the map's own
  excludedCount + plottedCount SUM (not against plottedCount alone derived by interval
  subtraction, which used to let individually-impossible excluded/plotted combinations pass),
  plus its own excluded-count band.
- `check:clubs-prerender` pins Norway's live CLUB count exactly (91), not as a band. That is a
  deliberate choice, not an oversight left over from before #55: a club is an organisation
  actually forming or dissolving, an event rare enough that a one-line bump when it happens is
  cheaper than the band engineering the other three checks needed. It is still, by the same rule
  as the other three, pinned against a live number, and will go stale the day that number
  changes; it is simply expected to change far less often. See
  `scripts/lib/curated-country-expectations.ts`'s own comment on `CLUB_ROSTER_EXPECTATIONS.rowCount`.
- `verify-scoring.mts` (#15, extended by #58) pins three numbers against a live KML fetch of trip
  1001428: the open-distance summary text (`48.95 km`), the turnpoint marker count for that
  geometry (`2`), and the per-flight disabled/enabled state of each radio option across four real
  flights — including, for trip 233524, the map's own scoring-overlay GeoJSON source shape after
  selecting the flat triangle (two features: a 4-coordinate closed loop, a 2-coordinate
  connector). Unlike the other four, what it pins against is not a roster that grows or shrinks
  over time, it is a handful of specific historical flights' already-flown GPS tracks and
  flightlog.org's own already-computed scoring geometry for each. Neither changes after the fact
  the way a takeoff or club roster does, so this pin is closer to the frozen-vs-frozen case above
  than a countdown, even though one side of it is still a live fetch.

See each constant's own doc comment, and `scripts/lib/curated-country-expectations.ts` generally,
for the specific numbers and the mutation testing that verified each band and the wind-direction
difference property.

`scripts/verify-*.mts` (`verify-map.mts`, `verify-track-gradient.mts`, `verify-track-hover.mts`,
`verify-scoring.mts`, `verify-feed.mts`, `verify-takeoffs.mts`, `verify-sites-map.mts`,
`verify-shot.mts`) are a different
kind of check: they drive a real headless browser against a running app, so they are deliberately
**not** part of `pnpm run check` or any other automated gate — there is nothing in this repo that
starts a server, waits for it, and tears it down again. Run them by hand after touching the
relevant feature. `verify-map.mts` and `verify-feed.mts` are the only two that run against
`pnpm dev` (e.g. `pnpm exec tsx scripts/verify-feed.mts`). `verify-takeoffs.mts` and
`verify-sites-map.mts` must run against `pnpm run build && pnpm run start`, never `pnpm dev`. Dev
can still serve the page, just differently: it would re-run `getTakeoffs`/`getRegions` against
flightlog.org live instead of exercising the prerendered static takeoffs artifact
`check:takeoffs-prerender` proves exists, which only exists after a real build. That difference is
not just about data freshness: a vacuous settle condition in `verify-takeoffs.mts` once read FAIL
against a build and PASS against dev, purely from timing slack. Dev's extra framework overhead
happened to leave enough time for the real fetch and filter to finish before the assertions ran,
so the same underlying bug passed there and failed against a build. Running against a build is
what makes a PASS trustworthy, not a guarantee that dev cannot serve the route at all.
`verify-track-gradient.mts` and `verify-track-hover.mts` (#47) are different: the
`window.__flightTrackMap` handle they depend on is gated behind the `?__verifyMap`
query param rather than `NODE_ENV` *precisely so it works against either mode* — a `NODE_ENV` gate
would have been dead-code-eliminated out of exactly the production build these scripts exist to
test (see `src/lib/maplibre/map-debug.ts`). Run them against `pnpm run build && pnpm run start`
anyway, by preference rather than necessity: dev is not forbidden, just the least likely place to
reproduce a bundler-specific failure, which is the whole reason these two scripts exist (see the
maplibre-gl v6/Turbopack note below).

`verify-scoring.mts` (#15, extended by #58) shares `verify-track-hover.mts`'s `?__verifyMap` gate
to check the scoring overlay against four real flights, each exercising a different shape: 1001428
(all five line-shaped geometries enabled and Open distance selected by default, its map source
actually loads and renders 2 turnpoint markers — both triangle radios correctly DISABLED, since
this fixture's own triangle placemarks are the metadata-only stub, not real geometry), 991729
(the degenerate 5- and 4-point geometries render as disabled radio options, not silently
selectable), 235690 (the entirely-missing out-and-return placemark is likewise disabled), and
233524 (#58: both triangle radios enabled — real, non-degenerate geometry — and, after selecting
the flat triangle, the map's own scoring-overlay source carries exactly two line features: a
self-closing 4-coordinate loop and a 2-coordinate connector). That last scene is the
browser-level oracle for the triangle RENDER path (`scoring-line.ts`'s scoringLineCoordinates):
nothing else — not Vitest, not `check-scoring.mts` — ever looks at what the map's own GeoJSON
source actually contains, so a render-path regression (e.g. drawing turnpointIndices as one
naive zigzag instead of loop-plus-connector) previously left every other check green. For
1001428 it also samples the capture's own pixels for the overlay's amber line colour (existence
of a source/layer alone would still pass for a wholly wrong or empty geometry), and drives an
actual toggle between two overlays to check that the map's own center/zoom stay put across it:
the effect that syncs the overlay is kept separate from the map-creation effect specifically so
switching overlays doesn't reset a user's pan/zoom, and nothing exercised that path before. Run
against `pnpm run build && pnpm run start`, same reason as `verify-track-gradient.mts`: the
overlay's map source is exactly the kind of thing the maplibre-gl v6/Turbopack bug would
silently fail to load.

`verify-shot.mts` (#21) is the odd one out: it doesn't verify a page, it verifies `scripts/shot.mts`
itself, by driving the exact capture function that script's CLI calls
(`scripts/lib/screenshot.ts`) and then looking at the pixels and dimensions of the PNG that
actually results. This is the canonical account of the bug it exists for; `screenshot.ts` and
`verify-shot.mts` each carry only a pointer back here plus reasoning specific to that file.

`shot.mts` once passed `fullPage: true` straight to Playwright's `screenshot()`, which silently
discards the WebGL drawing buffer on a page holding a MapLibre canvas — the canvas came back solid
white while DOM overlays (markers, controls, the barogram) kept rendering, so a broken capture read
as a partly working map rather than an obviously empty one. Nothing checked the PNG's actual pixels,
so it shipped and sat unnoticed. The first fix tried was to drop `fullPage` and resize the viewport
to the page's real (pre-resize) height instead, then take a plain screenshot — but on a page whose
height is itself a function of viewport height (the flight map is `h-[70vh]`), resizing the viewport
grows the page further, past the size that resize just measured, and a plain screenshot is bounded by
the viewport it's taken at: the barogram at the bottom of the page came back cut off mid-chart.
Re-adding `fullPage: true` ON TOP OF the resize — the combination that looked, before it was
measured, like it would just reintroduce the original bug — turns out to have neither problem:
the resize is what keeps the WebGL canvas painted (proven repeatedly against the real flight page),
and `fullPage`'s own stitching is what then picks up the further growth the resize itself causes.
That is the fix `screenshot.ts` ships. It has a limit worth knowing: Chromium's screenshot capture
has a hard ceiling somewhere between roughly 350,000 and 400,000px of page height (measured against
both a manual resize and `fullPage`'s own internal stitching alike — this is not something the
resize introduces), far beyond any page in this app, which tops out in the low thousands.

`verify-shot.mts` samples the flight track map's canvas region against its own live
`window.__flightTrackMap` ground truth (same `?__verifyMap` gate as `verify-track-gradient.mts`),
checking that the captured PNG's height covers the real document height, that the canvas region
isn't near-uniform (catches a blank capture), and that the live altitude-gradient's own colour
stops actually appear in it (catches the `fullPage` bug's opposite-shaped cousin too — tiles
rendering while the vector geometry silently doesn't, the same failure SHAPE as the maplibre
v6/Turbopack bug below, just triggered differently). It only covers the flight track map: #11's
takeoffs map has its own `verify-sites-map.mts`, which asserts on live MapLibre state directly and
never calls `page.screenshot()`, so it was never exposed to this bug in the first place — and
`shot.mts` itself has no way to reach that map to begin with (it's behind a "Map" toggle click the
script never performs, and the takeoffs directory page is exactly one viewport tall, so the resize
this fix depends on is a no-op there). Run against `pnpm run build && pnpm run start`, same reason
as `verify-track-gradient.mts`.

Vitest runs under jsdom, not a real browser, and its transform is Vite's, not Turbopack's — code
under test is not React Compiler transformed the way it is under `next build`, and it never touches
Turbopack. A passing Vitest test is not evidence the same code works in the app: this repo already
lost time once to a bundler-specific failure (maplibre v6's worker resolving through
`import.meta.url`, which Turbopack silently failed to wire up — raster tiles rendered, the GeoJSON
source just never loaded). Confirm anything Vitest touches with `pnpm dev` or a `verify-*.mts` run
too.

### Fixtures

`scripts/check-parsers.mts` runs against saved pages under `fixtures/`, which are **not committed**:
scraped profile pages carry contact details, both the account owner's and other pilots'. Absent
fixtures make `check:parsers` SKIP (exit 0) rather than fail — it never blocks `pnpm run check` in a
clean checkout, only in a checkout where fixtures were regenerated and then drifted from what the
parsers expect. Regenerate them locally (12677 is the account owner's own pilot id, with no GPS
tracks; 4549 is a pilot with GPS tracks; any pilot id works for either):

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
mkdir -p fixtures && curl -s -c /tmp/fl.txt -A "$UA" https://flightlog.org/ -o /dev/null
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=28&user_id=12677" -o fixtures/pilot-12677.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=28&user_id=4549" -o fixtures/pilot-4549.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=1001428" -o fixtures/track-1001428.kml
# The rest of these track-*.kml fixtures back check:scoring's scoring-overlay assertions (#15,
# extended by #58). requiredFixtures in check-scoring.mts gates the WHOLE script on all of them
# being present — one missing file SKIPs (loudly, exit 0) every assertion in it, not just the
# ones that fixture would back; accepted trade-off, since these are gitignored scraped fixtures
# absent in a clean checkout and the alternative (per-assertion skips) would silently narrow
# coverage in a checkout where only some got regenerated. 233524, 984290 and 985713 all carry
# real (non-degenerate) triangles — of the 18 track-*.kml fixtures on disk, 12 carry at least one
# — but 984290's FAI triangle and 985713's flat triangle are each the shared-endpoint variant
# (the connector shares an endpoint with the loop, so 5 distinct turnpoints collapse to 4 — see
# check-scoring.mts's own dedicated assertions against them); 233524 is the plain 5-distinct
# shape for both. 235690 is missing 3 scoring placemarks entirely (including both triangles);
# 991729 and 883027 are short flights with degenerate 5pt/4pt geometries; 742436 and 795416 are
# long XC flights. Any trip id with a GPS track works for rqtid=19 — these particular ids just
# happen to already exercise every absence/degenerate/shared-endpoint shape check:scoring pins
# against.
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=233524" -o fixtures/track-233524.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=235690" -o fixtures/track-235690.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=991729" -o fixtures/track-991729.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=883027" -o fixtures/track-883027.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=984290" -o fixtures/track-984290.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=985713" -o fixtures/track-985713.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=742436" -o fixtures/track-742436.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=795416" -o fixtures/track-795416.kml
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=9" -o fixtures/countries.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=25&country_id=160" -o fixtures/clubs-160.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=25&country_id=29" -o fixtures/clubs-29.html
# #7's club page. 51 (Voss) is the largest club sampled (1271 members); 33 (Oslo) has no
# Coordinates row, confirming that field is genuinely optional; 37 is a real club with zero
# members — the case rqtid=1 alone cannot tell apart from a nonexistent club_id, see
# docs/flightlog-api.md's "THE JOIN". Any large numeric club_id works for the nonexistent case.
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=26&country_id=160&club_id=51" -o fixtures/a26-51-club.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=26&country_id=160&club_id=33" -o fixtures/a26-33-club.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=26&country_id=160&club_id=37" -o fixtures/a26-37-club.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=26&country_id=160&club_id=999999999" -o fixtures/a26-nonexistent-club.html
# a=27 is dead (see docs/flightlog-api.md's correction) — these two fixtures exist only to
# pin that live, not to back a parser this app actually uses.
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=27&country_id=160&club_id=51" -o fixtures/a27-51-club.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=27&country_id=160&club_id=37" -o fixtures/a27-37-club.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=1&club_id=51&country_id=160" -o fixtures/rqtid1-51.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=1&club_id=37&country_id=160" -o fixtures/rqtid1-37.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=1&club_id=999999999&country_id=160" -o fixtures/rqtid1-nonexistent-club.html
# The danger #7 exists to make impossible: omitting club_id doesn't error, it silently returns
# a DIFFERENT club's pilots (see docs/flightlog-api.md). country_id alone, without club_id,
# does nothing useful — this fixture pins exactly that live measurement.
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=1&country_id=160" -o fixtures/rqtid1-missing-club-id.html
# country_id is decorative for this endpoint — omitting it (club_id present) is confirmed
# byte-identical to rqtid1-51.html.
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=1&club_id=51" -o fixtures/rqtid1-missing-country-id.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=114" -o fixtures/pilot-search-form.html
curl -s -b /tmp/fl.txt -A "$UA" -H "Content-Type: application/x-www-form-urlencoded" \
  --data "form=find_user&user_fullname=nde&go=Go" "https://flightlog.org/fl.html?l=1&a=114" -o fixtures/pilot-search-grouped.html
curl -s -b /tmp/fl.txt -A "$UA" -H "Content-Type: application/x-www-form-urlencoded" \
  --data "form=find_user&user_fullname=zzznomatchxyz123&go=Go" "https://flightlog.org/fl.html?l=1&a=114" -o fixtures/pilot-search-zero.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=11&country_id=160" -o fixtures/takeoffs-160.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=11&country_id=29" -o fixtures/takeoffs-29.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=10&country_id=160" -o fixtures/regions-160.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=10&country_id=29" -o fixtures/regions-29.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=8" -o fixtures/takeoff-schema.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=179" -o fixtures/a22-179-detail.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=119" -o fixtures/a22-119-detail.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=8478" -o fixtures/a22-8478-detail.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=999999999" -o fixtures/a22-nonexistent-detail.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=23&country_id=160&start_id=179" -o fixtures/a23-179-detail.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=42&country_id=160&start_id=179" -o fixtures/a42-179-flights.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=42&country_id=160&start_id=119" -o fixtures/a42-119-flights.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=42&country_id=160&start_id=999999999" -o fixtures/a42-nonexistent-flights.html
```

Routes:

- `/` a feed of recent flights across every followed pilot (the follow list lives in
  `localStorage`, read client-side via `/api/pilots/[userId]/recent-flights`)
- `/pilots/[userId]` logbook, one row per flight, linking flights that have a GPS track
- `/pilots/search` find a pilot by name, with a follow button per result
- `/flights/[tripId]` track on a map plus flight statistics
- `/countries` every country, linking into its club list
- `/countries/[countryId]` clubs in that country, with each club's member count, linking
  into each club's own page
- `/countries/[countryId]/clubs/[clubId]` a single club: description, coordinates, member
  roster (every member, each with a follow button), and a pilot-stats leaderboard sortable by
  flights/distance/hours, with a follow button only where a leaderboard row's name resolves to
  exactly one roster member
- `/countries/[countryId]/takeoffs` searchable/filterable takeoff directory for a curated
  country (list and map views), linking each takeoff into its own detail page
- `/countries/[countryId]/takeoffs/[takeoffId]` a single takeoff: description, region,
  altitude, PG/HG/HG2 site records, a map (when the country's coordinate dataset has one), and
  this year's flights from it, each with a follow button and a link to its track

## How it talks to flightlog.org

There is no documented API. Two undocumented surfaces are used, both reachable anonymously:

| What | Endpoint | Format |
| --- | --- | --- |
| Pilot profile + flights | `fl.html?l=1&a=28&user_id=N` | HTML, scraped |
| Pilot search | `POST fl.html?l=1&a=114` (`form=find_user`, `user_fullname`, `go=Go`) | HTML, scraped |
| Tracklog index for a pilot/year | `fl.html?rqtid=21&user_id=N&year=Y&ts=0` | JSON |
| Tracklog | `fl.html?rqtid=19&trip_id=N` | KML, ~1 Hz lon/lat/alt |
| Country list | `fl.html?rqtid=9` | HTML table, scraped |
| Clubs in a country | `fl.html?l=1&a=25&country_id=N` | HTML, scraped |
| Club detail + member roster | `fl.html?l=1&a=26&country_id=N&club_id=M` | HTML, scraped |
| Per-club pilot stats | `fl.html?rqtid=1&club_id=M` | HTML table, scraped |
| Regions in a country | `fl.html?rqtid=10&country_id=N` | HTML table, scraped |
| Takeoffs in a country | `fl.html?rqtid=11&country_id=N` | HTML table, scraped |
| Takeoff detail | `fl.html?l=1&a=22&country_id=N&start_id=M` | HTML, scraped |
| Flights at a takeoff (current year only) | `fl.html?l=1&a=42&country_id=N&start_id=M` | HTML, scraped |

`rqtid=21` and `rqtid=22` return self-describing JSON and appear to exist for GpsDump's sync. They are
the only real API-shaped thing on the site.

## Constraints that will break things if ignored

- **Browser User-Agent required.** A default `curl`/`fetch` agent gets a flat 403 from the WAF.
- **Session cookie required.** `GET /` issues `flightlog=<hex>`; without it every `fl.html` request
  302s to the root. `src/lib/flightlog/http.ts` mints, reuses and re-mints it.
- **Sessions die under crawler-shaped traffic.** ~200 requests varying one query parameter with a fixed
  `Referer` invalidated the session in under three minutes. Hence short session lifetime, a real
  `Referer` per request, and per-year track lookups instead of one request per flight row.
- **Honeypot link.** Every page carries an invisible `/resources/<random-hex>` link with
  `class='hp-nav'` and `data-trap='1'`. Never follow it.
- **The HTML is malformed.** `node-html-parser` finds 9 of 142 table rows on a real pilot page; cheerio
  parses all 134 flights. Use a spec-compliant HTML5 parser.
- **maplibre-gl is pinned to v5.** v6 resolves its worker through `import.meta.url` instead of inlining
  it, and Turbopack fails to wire that up. The failure is silent: raster tiles render, the GeoJSON
  source never loads, no console error. v5 inlines the worker as a blob.

Caching uses Cache Components (`use cache` + `cacheLife`) so repeated views do not re-hit the site:
flights hourly, tracks daily. Pilot search is deliberately **not** cached: every distinct query
string is its own cache key, so caching it would accumulate one entry per substring anyone ever
typed and would keep serving stale results for pilots who registered after the entry was cached —
unlike flights/tracks/countries/clubs, which all key on a closed, enumerable dimension (a pilot id,
a country id). It also has no minimum-length-driven debounce: `/pilots/search` is a plain GET
`<form>` read via `searchParams`, so a search only ever fires once, on explicit submit, not per
keystroke — there is nothing for a debounce to throttle. What *is* enforced is a floor on real
(non-wildcard) query characters before a query ever reaches the network — see
`src/lib/flightlog/pilot-search.ts`.

## Not done

- Writes. Login is `POST fl.html?l=1&a=37` (`form=login`, `login_name`, `pw`, no CSRF) and flight
  creation is a two-step wizard from `a=30`. Read-only for now.
- Private flights and the XLSX export (`a=214`) need an authenticated session.
- Altitude-coloured track, scoring geometries. The KML already carries all of it: FAI 3/4/5 point
  distance, open distance, out-and-return, flat and FAI triangle, plus per-point timestamps.

## Before running this against flightlog.org at any volume

The site is run by one person (`flightlog@erdalit.no`), has no terms of use, and signals through a WAF,
`noindex` and a honeypot that it does not want bots. Ask before pointing sustained traffic at it.

## Reference

Full reverse-engineered interface map: [`docs/flightlog-api.md`](docs/flightlog-api.md) — every known
`a=` action code, the `rqtid=` data endpoints, param vocabulary, KML payload shape, write-path forms,
and the anti-bot behaviour.
