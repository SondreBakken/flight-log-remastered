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
pnpm run check:follow-store               # followed-pilots store, pure core + storage adapter
pnpm run check:follow-button              # follow button presentation (label, aria-pressed, classes)
pnpm run check:feed                       # recent-flights feed: merge/sort/slice, year derivation, concurrency cap
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

`scripts/verify-*.mts` (`verify-map.mts`, `verify-track-gradient.mts`, `verify-track-hover.mts`,
`verify-feed.mts`, `verify-takeoffs.mts`, `verify-sites-map.mts`, `verify-shot.mts`) are a different
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
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=9" -o fixtures/countries.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=25&country_id=160" -o fixtures/clubs-160.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=25&country_id=29" -o fixtures/clubs-29.html
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
- `/countries/[countryId]` clubs in that country, with each club's total flight count
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
