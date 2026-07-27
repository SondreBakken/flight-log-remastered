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
pnpm exec tsx scripts/check-parsers.mts   # parsers against saved fixtures
pnpm run check                            # every check: below, in one pass
pnpm run check:barogram                   # barogram downsampling and scaling math
pnpm run check:track-gradient             # altitude colour ramp and gradient-stop distance math
pnpm run check:track-hover                # map/chart hover identity (shared index, not seconds)
pnpm run check:follow-store               # followed-pilots store, pure core + storage adapter
pnpm run check:follow-button              # follow button presentation (label, aria-pressed, classes)
pnpm run check:feed                       # recent-flights feed: merge/sort/slice, year derivation, concurrency cap
pnpm exec tsx scripts/shot.mts <url> <out.png>
```

`pnpm run check` is pure, source-only logic — no server needed. `scripts/verify-*.mts`
(`verify-map.mts`, `verify-track-gradient.mts`, `verify-track-hover.mts`, `verify-feed.mts`) are a
different kind of check: they drive a real headless browser against a running app (`pnpm dev`
first, then e.g. `pnpm exec tsx scripts/verify-track-hover.mts`), so they are deliberately **not**
part of `pnpm run check` or any other automated gate — there is nothing in this repo that starts a
server, waits for it, and tears it down again. Run them by hand after touching the map, the
barogram, or the feed.

### Fixtures

`scripts/check-parsers.mts` runs against saved pages under `fixtures/`, which are **not committed**:
scraped profile pages carry contact details, both the account owner's and other pilots'. Regenerate
them locally (any pilot id works; the second is one with GPS tracks):

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
mkdir -p fixtures && curl -s -c /tmp/fl.txt -A "$UA" https://flightlog.org/ -o /dev/null
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?l=1&a=28&user_id=4549" -o fixtures/pilot-4549.html
curl -s -b /tmp/fl.txt -A "$UA" "https://flightlog.org/fl.html?rqtid=19&trip_id=1001428" -o fixtures/track-1001428.kml
```

Routes:

- `/` a feed of recent flights across every followed pilot (the follow list lives in
  `localStorage`, read client-side via `/api/pilots/[userId]/recent-flights`)
- `/pilots/[userId]` logbook, one row per flight, linking flights that have a GPS track
- `/flights/[tripId]` track on a map plus flight statistics

## How it talks to flightlog.org

There is no documented API. Two undocumented surfaces are used, both reachable anonymously:

| What | Endpoint | Format |
| --- | --- | --- |
| Pilot profile + flights | `fl.html?l=1&a=28&user_id=N` | HTML, scraped |
| Tracklog index for a pilot/year | `fl.html?rqtid=21&user_id=N&year=Y&ts=0` | JSON |
| Tracklog | `fl.html?rqtid=19&trip_id=N` | KML, ~1 Hz lon/lat/alt |

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
flights hourly, tracks daily.

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
