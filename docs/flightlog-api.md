# flightlog.org — reverse-engineered interface

Verified live 2026-07-27. Nothing here is documented by the operator.

## Transport rules (mandatory)

- Browser `User-Agent` required. Plain `curl`/`python-requests` UA → `403` from the WAF on everything.
- Session cookie required. `GET /` sets `flightlog=<32-hex>` (HttpOnly, Secure, 1 year).
  Without it every `fl.html` request → `302 → /`. An anonymous session is enough for all public data.
- `Set-Cookie: last_x_days=7` is a UI preference, irrelevant.
- **Honeypot.** Every page contains
  `<a href='/resources/<random-hex>' class='hp-nav' style='position:absolute;left:-9999px' rel='nofollow' data-trap='1'>Resources</a>`
  Token is regenerated per request. Never follow `/resources/*`. A crawler that follows all hrefs will hit it.
- Everything routes through one script: `https://flightlog.org/fl.html`.
- `<meta name="robots" content="noindex, nofollow">` + `X-Robots-Tag: noindex, nofollow, noarchive` on all pages.
- Backend is PHP 8.4 (`x-powered-by`) behind a hardened proxy.
- **Cookie invalidation under crawl-shaped traffic.** A burst of ~200 requests varying only `a=`
  with a fixed `Referer` silently killed the session: known-good URLs began 302ing. Re-minting the
  cookie fixed it immediately. Elapsed time was 2-3 min at 0.4s/request, so this is pattern
  detection, not a rate limit. A real client must rotate the cookie periodically and send the
  actual previous-page URL as `Referer`.
- **302-to-root is ambiguous.** On `fl.html` it means either "no such action code" or "valid code,
  missing required param". Status and body size cannot tell them apart; only cross-referencing
  links found in other pages can.
- **Third response class:** `a=6` through `a=19` return 200 with byte-identical homepage content
  (only the language-switcher link differs). Unused codes that silently fall back rather than redirect.

Two disjoint parameter namespaces on `fl.html`:

| namespace | purpose | output |
|---|---|---|
| `a=<n>` | human pages + form posts | HTML |
| `rqtid=<n>` | data resources | HTML tables, JSON, KML, PNG |

## `rqtid` — the de-facto data API

All confirmed working with an **anonymous** session.

| rqtid | Params | Content-Type | Returns |
|---|---|---|---|
| 1 | `club_id`, `country_id` | text/html | Pilot stats table: Name, Flights, Distance (km), Time (hours) |
| 2 | (ignores params) | text/html | Single most recent flight site-wide. Columns: `trip_id, tripdate, triptime, duration_hhmm, cnt, distance_km, description, brandmodel, user_id, user_name, club_id, club_name, country_id, country_name, start_id, start_name, class_id` |
| 5 | `tz` | text/xml | Timezone → UTC time helper |
| 8 | — | text/html | Takeoff full schema (header row only unless params found): `altitude, altitudediff, country_id, createdby, createdname, createdtime, description, id, img_id, lat, lon, name, region_id, subregion_id, timestamp, updatedby, updatedtime, url, wind, tracklog_id, img_key, country_name, region_name, subregion_name` |
| 9 | — | text/html | **All countries.** `a2_code, a3_code, id, name, num_code, fips_a2, …` (ISO codes). Norway=160, Sweden=203, Iceland=98, France=73 |
| 10 | `country_id` | text/html | Regions: `country_id, id, name, …` |
| 11 | `country_id` **(required)** | text/html | **All takeoffs for a country** with coordinates: `id, name, lat, lon, wind, country_id, region_id, subregion_id, altitude, altitudediff`. Norway → 6012 rows |
| 12 | `country_id` / `region_id` | text/html | Takeoffs incl. long `description`, capped at 10 rows (recently-updated feed) |
| 18 | `trip_id` | image/png | Barogram image (1024×~940) |
| 19 | `trip_id` | application/vnd.google-earth.kml+xml | **Full tracklog KML** |
| 20 | `trip_id` | text/html | Google Maps view page |
| 21 | `user_id`, `year`, `ts` | application/json | **Tracklog index for a pilot** — self-documenting |
| 22 | `trip_id` | application/json | Tracklog timestamp for one trip — self-documenting |

`rqtid=3` → `Could not find image`. `rqtid=14,15,16,23-30` → empty 200. `rqtid=4,6,7,13,17` → empty body.
`rqtid=1` ignores name-fragment params — `name`, `pilot_name`, `search`, `q` each returned a
response byte-identical to the unfiltered `club_id`/`country_id` call (verified by exact string
comparison, not just length). No filter found; moot regardless since `a=114` is a full pilot search
(below).

### rqtid=21 (the sync endpoint)

```
GET /fl.html?rqtid=21&user_id=4549&year=2026&ts=0
{"description":"Returns id and ts (timestamp) for all tracklogs by a user in a given year
  that been created/updated after given ts. Use query string ?rqtid=19&trip_id={trip_id}
  to fetch tracklog in kml format.",
 "query_string_parameters":{"rqtid":21,"user_id":4549,"year":2026,"ts":0},
 "data_item_count":7,
 "data_fields":"trip_id, ts",
 "data_items":[[991729,"20260523164423"],[1001428,"20260720135025"], …]}
```

`ts` is an incremental-sync watermark (`YYYYMMDDHHMMSS`). This pair (21 → 19) is a complete
public read API for track data, almost certainly built for GpsDump Android.

### rqtid=19 KML payload

210 KB for a 2-hour flight. Contains:

- `<Metadata src="GpsDumpAndroid" v="…" type="trip">` and per-placemark `type` discriminators.
- Flight statistics block (date, start/finish, duration, max/min height, max speed 10s/60s,
  max/min climb 10s/60s).
- Seven scoring geometries as `<Placemark>`: `distance_5_point`, `distance_4_point`,
  `distance_3_point`, open distance, out-and-return, flat triangle, FAI triangle — each with
  turnpoint table (index, time, lat, lon, cumulative distance) and a `<LineString>`.
- `type="track"` placemark: `<SecondsFromTimeOfFirstPoint>` (whitespace-separated ints) +
  `<coordinates>` `lon,lat,alt` triples, ~1 Hz, `absoluteAltitude`.

No raw IGC download endpoint found. KML is the richest available form and is lossless enough
(1 Hz lon/lat/alt/time) to rebuild any view.

## `a` — HTML pages

Full sweep of `a=1..200` done with an authenticated cookie. Real pages:

| a | Page | Required | Optional |
|---|---|---|---|
| 1 | Home | — | — |
| 2 | Takeoffs, country index | — | `gm`, `last_days` |
| 3 | Pilots/Clubs, country index | — | — |
| 4 | Newsgroups | — | — |
| 5 | Help | — | — |
| 20 | Takeoffs, variant listing | — | — |
| 21 | Takeoffs in a country | `country_id` | `gm`, `last_days` |
| 22, 23 | **Takeoff detail** (coords, description, site records) | `country_id`, `start_id` | — |
| 24 | Pilots/Clubs, variant index | — | — |
| 25 | Clubs in a country | `country_id` | — |
| 26, 27 | **Club detail + member roster** | `country_id`, `club_id` | — |
| 28 | Pilot profile | `user_id` | `xc=xc`, `offset`, `year` |
| 29 | Pilot flights | `user_id` | — |
| 30 | New flight wizard — **write** | `user_id` | — |
| 31, 32 | Pilot page tab variants | `user_id` | — |
| 33 | Pilot trips in a year | `user_id`, `year` | — |
| 34, 35 | **Flight detail** | `trip_id` | `user_id` (not required) |
| 36 | Register form — **write** | — | — |
| 37 | Login — **write** | — | — |
| 42 | Flights at a takeoff | `country_id`, `start_id` | — |
| 43 | Club detail, alt | `country_id`, `club_id` | — |
| 45 | Register landing | — | — |
| 47, 48 | **Country flight list** | `country_id` | `year`, `tripdate`, `xc`, `offset` |
| 49 | Flights section | — | `last_x_days` |
| 55 | Competitions index | — | — |
| 56 | **Competition results** | `comp_id` | — |
| 102 | Pilot options | `user_id` | — |
| 107 | Takeoff search (POST `start`) | — | — |
| 114 | **Pilot search** (POST `form=find_user`, field `user_fullname`) | — | — |
| 142 | GpsDump info page | — | — |
| 214 | **XLSX export of a pilot's flights** | `user_id` | auth, own account only |

Resolved live 2026-07-27 — `101, 111, 114, 139` were seen only as link targets before this pass:
`a=114` is a real, working **pilot search**. `GET` renders a form (`action='/fl.html?l=1&a=114'`,
hidden `form=find_user`, text input `user_fullname`, submit `go=Go`; page copy says wildcards `%`
and `_` are supported). `POST`ing the same fields performs the search and returns matches as
`a=28&user_id=<id>` links grouped by country. Confirmed with `user_fullname=Henden`: three distinct
pilots matched (substring, not exact) — Børge Henden (2831), Nils Aage Henden (754), Patrick Henden
(11072), all under Norway. `a=139` also renders a real `<form>` (`airspace_lat`, `airspace_lon`) but
is an airspace/coordinate lookup, unrelated to pilots; not probed further. `a=101` and `a=111`
render real, homepage-distinct pages with no `<form>` and empty content shells: 101 is
`Pilots/Clubs > user > Flights > Test flights` (breadcrumb implies `user_id`-scoped), 111 is the
generic Flights section landing page reached via the Competition breadcrumb (implies
`comp_id`-scoped). Neither is pilot-related. Everything else in 1..200 returned the ambiguous 302
with no corroborating link anywhere in the crawl.

`comp_id` values observed: 1, 37, 161-168.

Takeoff detail (`a=22`) carries coordinates three ways: DMS in the body, UTM/WGS84, and decimal
degrees embedded in an outbound weather-API link (`Lat=61.89222222&Lon=9.14222222`). For bulk
work prefer `rqtid=11`, which gives decimal directly.

Param vocabulary: `l` (1=en,2=no,3=sv,4=is,5=fr,6=fi,7=de), `a`, `rqtid`, `user_id`, `trip_id`,
`country_id`, `region_id`, `subregion_id`, `start_id`, `club_id`, `comp_id`, `year`, `offset`,
`last_days`, `ts`, `xc`, `gm`, `thumb`.

Images: `/fl.html?rqtid=<n>&user_id=<id>&thumb&<n>` and `yi.html?h7=<token>`.

## HTML scrapeability

Hand-rolled server-side HTML, no JS, no client-side rendering. Fixed-position table columns,
consistent `bgcolor='white'` / `bgcolor='#22aa00'` striping, predictable `a=NN&param=X` link shapes
across every page type. A row-based parser is sufficient; no headless browser needed.

Flight row from `a=47&country_id=14`, trimmed:

```html
<tr><td bgcolor='white' colspan='6'><b>2026-07-25</b></td></tr>
<tr><td bgcolor='white'></td><td bgcolor='white' colspan='5'>
  <b><a href='?l=1&a=42&country_id=14&start_id=9006'>Emberger Alm</a></b>
</td></tr>
<tr>
  <td width='35' bgcolor='white'><img src='yi.html?h7=n6d' alt='Added in the last 24 hours'></td>
  <td width='45' bgcolor='white' align='right'>
    <a href='?l=1&a=34&user_id=754&trip_id=1002691'><img src='yi.html?h7=tgf' alt='View trip'></a>
  </td>
  <td width='450' bgcolor='white'>
    <a href='?l=1&a=28&user_id=754'>Nils Aage Henden</a> -
    <a href='?l=1&a=43&country_id=160&club_id=32'>Jetta Luftsportsklubb</a> -
    <a href='?l=1&a=48&country_id=160'>Norway</a><br>
    Moyes Litespeed RX 3,5
  </td>
  <td width='35' bgcolor='white' align='right'>01:55</td>
  <td width='50' bgcolor='white' align='right'></td>
  <td width='100' bgcolor='white' style='font-size:9px'>V/NV flisette etter en runde vestover</td>
</tr>
```

Columns: recency icon, trip-view icon link, pilot/club/country + glider, duration, distance
(blank when 0), free-text note.

Filter out `class='hp-nav'` / `data-trap` links before following anything.

## Write path

### Login
```
POST /fl.html?l=1&a=37
form=login & login_name=<user> & pw=<pass> & url= & rememberme=on
```
No CSRF token. Success → redirect carrying `user_id` in the query string. Session in `flightlog` cookie.

### New flight (multi-step wizard)
Step 1:
```
POST /fl.html?l=1&user_id=<id>&a=30
form=new_trip_from_country & start_name=<text> & country_id=<select>
```
Step 2 posts the trip form. Known fields from third-party clients:
`form=trip_form`, `tracklog` (multipart .igc), `class_id` (1=PG), `brandmodel` / `brandmodel_id`,
`takeofftype_id`, `cnt=1`, `save=Save`, and `&no_start=y` on the query string to skip takeoff selection.

## Gated behind auth
- `a=214` XLSX export (anonymous request silently falls back to the HTML flight list).
- Private flights, edit/delete, incident reports, personal options.

## Prior art
- `SebastianGrans/flightlog.org-uploader` (Python, active 2026) — IGC upload via form emulation.
- `storlien/flightlog-importer` (Selenium, 2025).
- `Tomasuh/XContest_to_Flightlog` (2020), `MrElendig/wingsum` (2020), `alelode/flightlog-dump` (TS, 2019),
  `hauglum/flightlog` (Java, 2022).

All scrape HTML or drive the form. None knew about the `rqtid` namespace.
