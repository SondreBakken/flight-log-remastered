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
pnpm run check                            # every check:* script plus the test suite, in one pass
pnpm test                                 # Vitest: components, jsdom + React Testing Library
pnpm lint                                 # ESLint
```

Verify scripts (most driving a real browser, one driving Supabase directly) and the full testing
story (checks, pins, fixture regeneration) live in [`docs/testing.md`](docs/testing.md).

## Routes

- `/` a feed of recent flights across every followed pilot (the follow list lives in
  `localStorage`, read client-side via `/api/pilots/[userId]/recent-flights`)
- `/pilots/[userId]` logbook, one row per flight, linking flights that have a GPS track, plus a
  pilot statistics dashboard (#16) and a flown-sites map with counted unmatched takeoffs (#76)
- `/pilots/search` find a pilot by name, with a follow button per result
- `/flights/[tripId]` track on a map plus flight statistics, a scoring-overlay selector, and the
  altitude-coloured track
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

## Before running this against flightlog.org at any volume

The site is run by one person (`flightlog@erdalit.no`), has no terms of use, and signals through a WAF,
`noindex` and a honeypot that it does not want bots. Ask before pointing sustained traffic at it.

## Reference

Full reverse-engineered interface map: [`docs/flightlog-api.md`](docs/flightlog-api.md) — every known
`a=` action code, the `rqtid=` data endpoints, param vocabulary, KML payload shape, write-path forms,
and the anti-bot behaviour.

Full testing reference: [`docs/testing.md`](docs/testing.md) — every `check:*` script, the
frozen-vs-live pin philosophy, the browser `verify-*.mts` scripts, and fixture regeneration.
