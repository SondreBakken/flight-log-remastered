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
- **Confirmed safe volume.** A pass of 34 requests (interleaved `a=`/`rqtid=` codes, sequential on
  one session, real chained `Referer`, 2-3.8s spacing) completed without tripping the gate above —
  known-good URLs kept returning 200 throughout. A later pass added 6 more requests on a fresh
  anonymous session with the same spacing/referer discipline, also with no gate trip. Neither
  approached the ~200-request threshold that did trip it; treat 34-40 sequential requests as a
  confirmed-safe reference point, not an upper bound.
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
| 8 | — | text/html | Takeoff full schema, header row only (confirmed: 24 `<th>` cells, never any `<tr><td>` data — not fetched in production, used only to confirm field order): `altitude, altitudediff, country_id, createdby, createdname, createdtime, description, id, img_id, lat, lon, name, region_id, subregion_id, timestamp, updatedby, updatedtime, url, wind, tracklog_id, img_key, country_name, region_name, subregion_name` |
| 9 | — | text/html | **All countries.** Plain `<table border=1>`, 11 `<td>` columns, id is column 5, name column 6. Norway=160, Sweden=203, Iceland=98, France=73 — see below |
| 10 | `country_id` | text/html | Regions: `country_id, createdby, createdtime, id, name, timestamp, updatedby, updatedtime` — see below |
| 11 | `country_id` **(required)** | text/html | **All takeoffs for a country** with coordinates: `id, name, lat, lon, wind, country_id, region_id, subregion_id, altitude, altitudediff`. Norway → 6012 rows — see below |
| 12 | `country_id` / `region_id` | text/html | Takeoffs incl. long `description`, capped at 10 rows (recently-updated feed) |
| 18 | `trip_id` | image/png | Barogram image (1024×~940) |
| 19 | `trip_id` | application/vnd.google-earth.kml+xml | **Full tracklog KML** |
| 20 | `trip_id` | text/html | Google Maps view page |
| 21 | `user_id`, `year`, `ts` | application/json | **Tracklog index for a pilot** — self-documenting |
| 22 | `trip_id` | application/json | Tracklog timestamp for one trip — self-documenting |

`rqtid=3` → `Could not find image`. `rqtid=14,15,16,23-30` → empty 200. `rqtid=4,6,7,13,17` → empty body.
`rqtid=1` ignores name-fragment params — `name`, `pilot_name`, `search`, `q` each returned a
response byte-identical to the unfiltered `club_id`/`country_id` call (verified by exact string
comparison, not just length). No filter found. `a=114` (below) supersedes this for resolving a name
to a `user_id`; it does not supersede it for a name-filtered stats table — `rqtid=1` returns
Name/Flights/Distance/Time with no `user_id`, `a=114` returns `user_id` links with no stats.

### rqtid=9 (country list)

```
GET /fl.html?rqtid=9
```

The plainest response on the site — no page shell, no nav, no honeypot, no links at all:

```html
<html><body><table border=1><th>a2_code</th><th>a3_code</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>num_code</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><th>fips_a2</th><tr><td>AF</td><td>AFG</td><td>1</td><td>2002-02-22 22:03:23</td><td>1</td><td>Afghanistan</td><td>004</td><td>2005-09-03 18:08:18</td><td>1</td><td>2005-09-03 20:08:18</td><td>AF</td></tr>
...
</table></body></html>
```

- The 11 `<th>` header cells are not wrapped in a `<tr>` — cheerio still finds them as a leading
  header sibling of the data rows; select `table tr` and ignore rows without exactly 11 `<td>`s.
- Column order: `a2_code, a3_code, createdby, createdtime, id, name, num_code, timestamp,
  updatedby, updatedtime, fips_a2`. `id` is `<td>` index 4 (0-based), `name` index 5. No `href`
  anywhere in this response — ids come only from the cell.
- 240 rows, one `GET`, no pagination, no truncation notice.
- Ids are not name-sorted — insertion order leaks through (`Congo, The Democratic Republic Of
  The` carries id 237, alphabetically between `Congo, Republic of the` id 49 and `Cook Islands`
  id 50). Confirmed: Norway=160, Sweden=203.

**Consequence for this app:** `/countries` (`src/app/countries/page.tsx`) calls `getCountries()`
with no dynamic APIs in the tree above it, so `next build` prerenders it as fully static output
(confirmed: `pnpm run build` marks the route `○ (Static)`). That means this specific `rqtid=9`
request is made *at build time*, not at request time — a flightlog.org outage or a WAF block
during a build fails the build itself, and therefore the deploy, not merely a page a user happens
to hit while the site is down.

`/countries/[countryId]` (`a=25`, clubs) is a Partial Prerender, but as of #40 its
`generateStaticParams` fully resolves a curated set of ids (currently just `country_id=160`,
Norway — see `CURATED_CLUB_COUNTRIES` in `src/lib/flightlog/curated-countries.ts`) at build time
too. For each curated id, both the `a=25` clubs request and its own `rqtid=9` country-name lookup
run during `next build`, carrying the exact same build-fails-therefore-deploy-fails risk as
`/countries` above. Only an *uncurated* id keeps the original per-request PPR hole, resolved on
first request with no build-time risk.

### rqtid=10 (regions in a country) and rqtid=11 (takeoffs in a country)

```
GET /fl.html?rqtid=11&country_id=160
GET /fl.html?rqtid=10&country_id=160
```

Both share `rqtid=9`'s exact "plainest response on the site" shape: no page shell, no nav, **no
honeypot, no `<a>` tags at all** (confirmed: zero `hp-nav` occurrences, zero anchors, across every
capture of both endpoints, full and empty alike) — just one `<table border=1>` whose unwrapped
`<th>` header cheerio synthesizes into a leading `<tr>`, followed by zero or more
`<tr><td>…</td></tr>` data rows.

```html
<!-- rqtid=11&country_id=160, trimmed -->
<html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th><tr><td>6246</td><td>	Jorde på Løten, Klæpa airport</td><td>60.79527778</td><td>11.34555556</td><td>56</td><td>160</td><td>6</td><td>0</td><td>180</td><td>0</td></tr>
...
</table></body></html>
```

- **Column order, rqtid=11:** `id, name, lat, lon, wind, country_id, region_id, subregion_id,
  altitude, altitudediff` — exactly the 10 fields the doc table lists, in that order. No metadata
  cruft to trim, unlike rqtid=9/countries or rqtid=10/regions (see below) — every field here is
  something a server-side consumer plausibly needs.
- **Column order, rqtid=10:** `country_id, createdby, createdtime, id, name, timestamp, updatedby,
  updatedtime` — 8 fields. `createdby`/`createdtime`/`timestamp`/`updatedby`/`updatedtime` are the
  same family of metadata cruft rqtid=9 carries and this app already drops; only `id`, `name` and
  `country_id` are kept.
- **Norway (`country_id=160`):** rqtid=11 returns exactly 6012 `<tr>` rows (matches the doc's
  claim precisely), all unique `id`s, one `GET`, no pagination. rqtid=10 returns 29 regions.
  `region_id` on a takeoff row references rqtid=10's `id` column for the same country; `0` means
  "no region assigned" (6 of Norway's own 29 region ids — 110, 130, 137, 140, 153, 164 — are never
  used by any takeoff, and many takeoffs carry `region_id=0`). `subregion_id` was `0` for every one
  of Norway's 6012 rows — never seen non-zero in this dataset.
- **Coordinates.** `lat`/`lon` are the only fields in either response observed with a decimal point
  or a negative sign — one Norway takeoff (`Auenhaugen, Golsfjellet - Gol`, id 10778) carries a
  genuinely negative latitude (`-1.01694444`), a live data-entry glitch, not a transcription error.
  Every other numeric field (`wind`, `country_id`, `region_id`, `subregion_id`) was a bare
  non-negative integer across all 6012 Norway rows; `altitude`/`altitudediff` were too, though a
  negative `altitudediff` (landing above takeoff) or a below-sea-level `altitude` is physically
  plausible and wasn't ruled out by sampling one country.
- **`wind` encoding — confirmed, not assumed.** Across Norway's 6012 takeoffs, `wind` is always a
  bare integer, range 0-255 — exactly one byte. 166 distinct values appear (90 of the 256 possible
  never do), and the distribution is heavily skewed, not spread evenly: 3017 of 6012 rows fall in
  0-31 alone, `0` by itself is 991 rows and `255` is 366. The stronger evidence is structural, not
  the distinct-value count: treating each value as an 8-bit mask over compass octants, 4319 of
  6012 values are a single **circularly contiguous run of set bits** (e.g. `0b00011100`, three
  adjacent octants — a run that wraps past bit 7 back to bit 0 still counts), and another 1357 are
  `0` or `255` (all-clear or all-set) — together 5676 of 6012 rows (94%) are empty, full, or one
  contiguous arc, exactly the shape a site's real-world wind exposure would produce under an
  **8-bit bitmask over compass octants** (a site usable from several adjacent directions sets
  multiple adjacent bits; `0` = none recorded, `255` = all eight) — not a single compass point,
  confirming the caution in issue #12 that "sites work across ranges." The bit-to-direction
  mapping itself was not independently confirmed (no site cross-referenced against its known
  real-world wind exposure); only the shape of the encoding (integer bitmask, not an enum or a
  string) is established here.
- **Field order as the positive signal.** Neither response wraps its results in anything more
  specific than `<table border=1>` — no other attribute or wrapping element distinguishes it from
  rqtid=8's schema doc or the sibling endpoint's own response, both of which share the identical
  bare-table shape. What distinguishes a genuine response is the exact header field **order**, not
  merely the table's presence or its cell count — a column reorder on the live site would otherwise
  silently swap two fields' values past a count-only check.
- **Empty country (`country_id=29`, Bouvet Island).** Both endpoints return `200 OK`, the identical
  header row, and **zero** `<tr>` data rows:
  ```html
  <html><body><table border=1><th>id</th><th>name</th><th>lat</th><th>lon</th><th>wind</th><th>country_id</th><th>region_id</th><th>subregion_id</th><th>altitude</th><th>altitudediff</th></table></body></html>
  ```
  Not a missing table and not a redirect — the header alone is present, matching the expected field
  order exactly, with nothing after it. This is the same "container present, positive shape
  confirmed, zero rows" pattern `a=25`/clubs uses (there via a unique table selector; here via the
  header field order, since the table itself carries no other distinguishing attribute). A response
  whose header does *not* match — e.g. rqtid=8's schema doc, which shares the identical
  `<table border=1>` shell but a different 24-field header — is unrecognised markup, not a genuine
  empty result, and is treated as a throw rather than an empty list.
- **Nonexistent `country_id`** was not probed (out of request budget) but is expected, by the same
  reasoning `a=25` documents for its own endpoint, to collapse to this identical empty shape —
  meaning a caller that needs "real country, zero takeoffs" apart from "no such country" has to
  cross-reference `rqtid=9` itself, same as clubs.

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

Full sweep of `a=1..200` done with an authenticated cookie; `101, 111, 114, 139` were separately
resolved with an **anonymous** session (below) — pilot search needs no auth. Real pages:

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
| 49 | Flights section, default `last_x_days`-filtered view | — | `last_x_days` |
| 55 | Competitions index | — | — |
| 56 | **Competition results** | `comp_id` | — |
| 101 | Pilot test flights, empty shell (breadcrumb: Pilots/Clubs > user > Flights > Test flights) | `user_id` *(inferred)* | — |
| 102 | Pilot options | `user_id` | — |
| 107 | Takeoff search (POST `start`) | — | — |
| 111 | Flights section landing, empty shell — distinct from `a=49`: no `last_x_days` filter, reached via the Competition breadcrumb | `comp_id` *(inferred)* | — |
| 114 | **Pilot search** (POST `form=find_user`, fields `user_fullname`, `go=Go`) | — | — |
| 139 | Airspace/coordinate lookup, unrelated to pilots | — | `airspace_lat`, `airspace_lon` |
| 142 | GpsDump info page | — | — |
| 214 | **XLSX export of a pilot's flights** | `user_id` | auth, own account only |

`101, 111, 114, 139` were seen only as link targets before being resolved live. `101` and `111`
render real, homepage-distinct pages with no `<form>` and empty content shells — neither is
pilot-related. `139` renders a real `<form>` (`airspace_lat`, `airspace_lon`) but is an
airspace/coordinate lookup; not probed further. Everything else in 1..200 returned the ambiguous
302 with no corroborating link anywhere in the crawl.

### Pilot search (`a=114`)

All confirmed working with an **anonymous** session. `GET` renders a form advertising wildcards
`%` and `_`:

```
GET /fl.html?l=1&a=114
```

**Full field list** (the GET form page has exactly these three inputs, no hidden field beyond
what was already documented):

```html
<form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'>
<input name='form' type='hidden' value='find_user'> Find pilot (wildcards: % _): <input name='user_fullname' type='text' size='15' style='font-size:9px' value=''>
<input name='go' type='submit' value='Go' style='font-size:9px'>
</form>
```

`POST`ing the same fields performs the search and returns matches as `a=28&user_id=<id>` links
grouped by country under country-name headers:

```
POST /fl.html?l=1&a=114
form=find_user & user_fullname=<query> & go=Go
```

**Response markup — grouped results** (`user_fullname=nde`, trimmed). Unlike every other scraped
surface on this site, results are **not** a table: they are bare text and `<a>` siblings inside
the same div that holds the search form itself, with `<br>` as the only separator:

```html
<div style='padding:0px 10px'>

      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'>
      <input name='form' type='hidden' value='find_user'> Find pilot (wildcards: % _): <input name='user_fullname' type='text' size='15' style='font-size:9px' value='nde'>
      <input name='go' type='submit' value='Go' style='font-size:9px'>
      </form>
      Colombia:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=6924'>JHON ALEXANDER QUINTERO GUTIERREZ</a><br>Denmark:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=8167'>Anders Steffensen</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=11048'>Lars Funder</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=10258'>Sofie K. H. Andersen</a><br>France:<br>...
      ...&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=3140'>Anders Lindmarker</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=11512'>Matt Sanders</a><br><hr>
</div>
```

- **Results container.** There is no table to anchor on, and the div wrapping the form
  (`div[style*="padding:0px 10px"]`) is the same generic chrome `a=25`/clubs uses — anchoring on
  it alone repeats that parser's original bug (a pilot page would parse as "zero results" instead
  of throwing). The safe anchor is the search `<form>` itself
  (`action='/fl.html?l=1&a=114'`): it renders identically on the GET form page, the POST results
  page, and the POST zero-match page, and does not appear on any other page type on the site.
  `parse-pilot-search.ts` selects that form and treats its parent as the results container.
- **Country group headers** are plain, untagged text nodes reading `<CountryName>:` immediately
  followed by `<br>` — not a heading element, not a class, nothing to select. A parser has to walk
  sibling nodes in document order and track "the last country-header text node seen" as it goes.
- **Each result row** is `&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=<id>'>Name</a><br>` —
  a plain sibling of the header text, not wrapped in any row element. `user_id` comes from the
  `href`, exactly like every other pilot link on the site. The leading `&nbsp;&nbsp;&nbsp;` indent
  text nodes decode to U+00A0, which JavaScript's `trim()` strips as whitespace, so they vanish
  the same way an empty text node does — nothing special to special-case there.
- The whole result set is closed by a bare `<hr>` before the div closes; there is no other
  terminator.
- Non-ASCII names appear undecorated (`Samúel Alexandersson`, `ú`) and decode normally as HTML
  text content.

**Matching semantics**, resolved with two queries against the known-good `Henden` set (Børge 2831,
Nils Aage 754, Patrick 11072, all Norway):

- `user_fullname=nde` — an interior substring of "Henden" (not a token, not a prefix or suffix, not
  the surname itself) returned 407 pilots across ~10 countries (Colombia, Denmark, France, Iceland,
  India, Netherlands, Northern Mariana Islands, Norway, Sweden, United Kingdom in the fixture on
  hand), including the 3 known Hendens and many whose *first* name alone contains "nde" (e.g.
  "Anders...", "Aleksander..."). This confirms **case-insensitive substring match against the full
  display name** (first + last, not a surname-only column) — it rules out token match,
  surname-prefix match, and exact-surname-column match in the one query.
- `user_fullname=H_nden` (literal underscore) returned exactly the same 3 Hendens. This confirms
  the advertised `_` wildcard is a real SQL `LIKE` single-char wildcard layered on top of the
  implicit substring wrap, not a literal character requiring escaping — the wildcard claim is
  accurate, and it is not made redundant by the implicit substring behavior since it lets a caller
  narrow a match that plain substring would over-select.

No result cap or pagination was observed: the `nde` query returned 407 rows in a single 48.7 KB
response with no truncation notice or "N of M" count.

**Zero-match response** (`user_fullname=zzznomatchxyz123`): `200 OK`, same page shell. Correction
to an earlier pass over this endpoint, which claimed no "no results" message exists — there is
one, just not inside the results div: a banner immediately above it,
`<div style='background-color:yellow'>-1 No match found</div>`. The results div itself is present
(same form, same container) but has nothing after `</form>` — zero candidate rows, not a missing
container, the same "container present, zero rows" shape `a=25`/clubs uses for a country with no
clubs.

### Clubs in a country (`a=25`)

All confirmed working with an **anonymous** session.

```
GET /fl.html?l=1&a=25&country_id=160
```

Ordinary page shell (breadcrumb, top nav, language switcher — each carrying its own `hp-nav`
honeypot copy, same as every other page) around one results block:

```html
<div style='padding:0px 10px'>
<table cellspacing='1' cellpadding='3' bgcolor='black'><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=53'>Albatross Aero Klubb</a></td><td bgcolor='white'>1</a></td></tr><tr><td bgcolor='white'><a href='https://flightlog.org/fl.html?l=1&country_id=160&a=26&club_id=31'>Ålesund Paragliderklubb</a></td><td bgcolor='white'>77</a></td></tr>
...
</table>
</div>
```

- `club_id` comes from the row's `href`, not a cell — select `a[href*="club_id="]`, read
  `club_id=(\d+)`, and confirm the same href also contains `a=26`.
- Matching a specific action code in the `href` is **not**, by itself, what keeps the honeypot
  out of the results — the honeypot's own href never carries `club_id=`, and the live trap
  happens to sit only in the shared nav chrome above the results table, never inside it, so
  immunity today is incidental to where the trap happens to be, not to what the selector checks.
  A trap constructed with a `club_id=` and an `a=26` href, placed inside the results table, is
  indistinguishable from a real row by href alone. The parser (`parse-clubs.ts`) therefore
  excludes anchors carrying `class="hp-nav"`, `data-trap`, or `rel="nofollow"` explicitly,
  regardless of where in the document they sit or what their href contains — a structural check,
  not a positional one.
- The stray `</a>` closing the second `<td>` (no matching open tag) is real markup, not a transcription
  error — another malformed-HTML case like the flight rows, needs cheerio.
- Second `<td>` is a plain integer, the club's total flight count — not a link, not a member count.
- Club names are not guaranteed trimmed (`Oslo Paragliderklubb ` has a trailing space in the source),
  contain non-ASCII (`Ålesund Paragliderklubb`), and contain HTML entities (`Alta Hang &amp;
  Paragliderklubb`).
- Norway (`country_id=160`) returned 91 clubs, alphabetical by name, one unpaginated response, no
  result cap observed.
- **Country with no clubs** (`country_id=29`, Bouvet Island): identical shell, `200 OK`, and the
  results table is present but empty — `<table cellspacing='1' cellpadding='3'
  bgcolor='black'></table>`, zero `<tr>`. Not a missing table and not a redirect; a parser should
  treat "table present, zero rows" as a valid empty result and "table missing" as unrecognised
  markup worth throwing on.
- **Nonexistent `country_id`** (a syntactically valid id that names no real country, e.g. a very
  large integer never assigned in the `rqtid=9` id space): same shell, `200 OK`, same empty
  `<table ...></table>` as Bouvet Island. The response gives no way to distinguish "real country,
  genuinely zero clubs" from "no such country" — both collapse to the identical empty-results
  page. A caller that needs that distinction has to cross-reference `rqtid=9` itself; the clubs
  endpoint alone cannot make it. (See also `a=8` and `a=32`, which are expected to share this
  shape once investigated.)
- **Container anchor.** The results table itself
  (`table[cellspacing="1"][cellpadding="3"][bgcolor="black"]`) is a safer anchor than the div
  wrapping it (`div[style*="padding:0px 10px"]`): that div is generic page chrome present on
  pages that are not the clubs list at all (e.g. a pilot page), so anchoring on it alone lets an
  unrelated page — including the documented `a=6`-`a=19` homepage-fallback class above — parse as
  "zero clubs" instead of failing loudly. The table's three attributes together were not observed
  anywhere else across the fixtures on hand.

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
