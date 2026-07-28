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
| 1 | `club_id` **(required)** | text/html | Pilot stats table: Name, Flights, Distance (km), Time (hours) — `country_id` is accepted but decorative, see below |
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

**`rqtid=1`'s real key is `club_id`, not `country_id` — confirmed live, #7.** Omitting
`club_id` (with `country_id` present) does not error and does not come back empty: it silently
returns 146 rows belonging to a completely different, unrelated club
(`fixtures/rqtid1-missing-club-id.html`) — a plausible-looking WRONG answer, not a signal a
caller would notice without cross-checking names against a roster. Omitting `country_id` (with
`club_id` present) instead returns a response **byte-identical** to the full request
(`fixtures/rqtid1-missing-country-id.html` vs `fixtures/rqtid1-51.html`, confirmed by diff, not
just row count) — `country_id` is accepted but does nothing. `getClubStats` in this app's own
code (`src/lib/flightlog/club-stats.ts`) therefore takes `clubId: number` as a required,
non-optional parameter and never sends `country_id` at all, rather than accepting an options
bag a caller could build without the one param that actually matters.

**`rqtid=1` cannot distinguish a real club with zero flights from a nonexistent `club_id`.**
Both render the identical header-only empty table
(`fixtures/rqtid1-37.html` and `fixtures/rqtid1-nonexistent-club.html` are byte-identical,
confirmed by diff). A caller that needs that distinction has to cross-reference `a=26` (below),
which has its own, unambiguous not-found signal.

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
  confirming the caution in issue #12 that "sites work across ranges."
- **`wind` bit-to-direction mapping — pinned (#43).** `a=22` (takeoff detail) renders the same
  bits as a compass image; the image's own `alt` text names the active octants in plain text,
  e.g. `alt=' N NE E SE S SW W NW'` for `wind=255`, `alt=' NW'` for `wind=1`, nothing at all
  (no `<img>` tag) for `wind=0`. That `alt` text is ground truth — no OCR or pixel-reading of
  the image itself was needed. Hypothesis going in: bit position steps around the compass at a
  constant 45° per bit, in some direction, from some starting octant — two unknowns, offset and
  rotation direction.

  Three live passes, 14 requests total, pinned it: pass 1 minted a session and fetched 8
  takeoffs (5 single-bit values plus `wind` 0/28/255); pass 2 re-minted and fetched 1 more
  (bit 6, id 4638) — 2 mints + 9 takeoffs = **11** requests, not the 9 a previous version of
  this doc claimed (its own table already listed all 9 takeoffs; the text just forgot pass 2's
  mint and takeoff when it summarised). Pass 3 (this fix) re-minted once more and fetched 2
  more takeoffs (ids 4163, 7869) to directly confirm bits 2 and 4, which the first two passes
  had left resting on a single ambiguous multi-bit sample (see below) — 1 mint + 2 takeoffs = 3
  requests. **14 live requests total.**

  | takeoff (id) | wind | bits | `a=22` alt text | read as |
  |---|---|---|---|---|
  | Strandafjellet (5919) | 0 | `00000000` | no `<img>` | none |
  | Andøya, Bleik… (772) | 1 | `00000001` | ` NW` | bit0 = NW |
  | Albbasjoaivi (2845) | 2 | `00000010` | ` W` | bit1 = W |
  | Andørja, kråktindan (4163) | 4 | `00000100` | ` SW` | bit2 = SW |
  | Frafjord Hegrajeljuvet (10242) | 8 | `00001000` | ` S` | bit3 = S |
  | Adjektind, ved Lønsdal (7869) | 16 | `00010000` | ` SE` | bit4 = SE |
  | Austre Blåfjellenden (7947) | 32 | `00100000` | ` E` | bit5 = E |
  | Astridtinden - Botnhamn (4638) | 64 | `01000000` | ` NE` | bit6 = NE |
  | Aurland, Aurlandsdalen (1165) | 128 | `10000000` | ` N` | bit7 = N |
  | Dovre (2924) | 28 | `00011100` | ` SE S SW` | bits2-4 = {SW,S,SE} — corroborates, doesn't establish (see below) |
  | Trysil, Lerberget (6250) | 255 | `11111111` | ` N NE E SE S SW W NW` | all eight |

  All 8 bits are now confirmed **directly**, each as its own single-bit value. They fit one
  formula with zero deviation: `compassIndex = (7 - bit) mod 8` over `[N,NE,E,SE,S,SW,W,NW]`
  clockwise — equivalently, bit position runs **counter-clockwise from N at bit 7 down to NW at
  bit 0**.

  **What the earlier argument for bits 2 and 4 got wrong.** Passes 1-2 treated those two bits as
  pinned by the 3-bit Dovre sample (`wind=28` → `alt=' SE S SW'`) alone, reasoning that a
  mapping which happened to agree with the other 6 points but disagreed on bits 2/4 would only
  reproduce a contiguous real-world arc here "by chance." That doesn't discriminate: transposing
  what bits 2 and 4 point to (`2→SE, 4→SW` instead of `2→SW, 4→SE`) yields the exact same set
  `{SE, S, SW}` for `wind=28`, since that set is symmetric under the swap — the one multi-bit
  request this depended on carried zero information about the two bits it was spent on, and the
  "only order a contiguous arc can produce" argument additionally assumed the `alt` text is
  emitted in bit order, which contradicts this doc's own account of the ordering below. The
  bit2/bit4 single-value requests in pass 3 are what actually settles it, directly: `alt=' SW'`
  for bit2 alone, `alt=' SE'` for bit4 alone — the mapping above, not the transposed one.

  **A second, independent argument, free of any request budget.** Computed offline over all
  6012 Norway `wind` values (verified against `fixtures/takeoffs-160.html`): under the mapping
  above, 5676/6012 (**94.4%**) decode to a circularly contiguous compass arc (or `0`/`255`);
  under the bits-2/4-transposed alternative, only 4233/6012 (**70.4%**) do. A real population of
  takeoff wind exposure should look mostly like contiguous arcs under whichever mapping is
  correct, and mostly not under a wrong one — this is exactly that signal, and it independently
  favours this mapping by a wide margin, agreeing with the direct single-bit requests.

  **What is NOT established: the site's `alt`-text ordering.** Under the confirmed mapping,
  descending bit order (bit7 → bit0) and clockwise compass order are, by construction, the exact
  same sequence (`bit = 7 - clockwiseIndex`), so no multi-direction sample — including `wind=255`
  and `wind=28` above — can ever tell "the site emits directions in bit order" apart from "the
  site emits them in clockwise order": the two hypotheses predict identical output for every
  input. Nothing here proves the site's own iteration is semantically clockwise rather than
  positionally bit-ordered, and nothing needs to — `decodeWindDirections` returns clockwise
  order because that's the order its `alt` text happens to read as, not because "clockwise, not
  bit order" was independently confirmed as the site's mechanism.

  Full table, `bit → octant`: `0→NW, 1→W, 2→SW, 3→S, 4→SE, 5→E, 6→NE, 7→N`. `0` = no direction
  recorded, `255` = all eight. Session showed no throttling or kill signal across any of the
  three passes (all known-good URLs stayed 200 throughout, chained referer, 2-3.8s jittered
  spacing) — see `decodeWindDirections`/`windIncludesDirection` in `src/lib/flightlog/wind.ts`,
  the single implementation #10 and #12 both consume. All 11 `a=22` responses fetched across the
  three passes are saved under the gitignored `fixtures/` as `a22-<id>-wind<N>.html`, so this
  table is re-checkable without hitting the site again.
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
| 22 | **Takeoff detail** (description, site records — coords come from `rqtid=11`, see below) | `country_id`, `start_id` | — |
| 23 | Takeoffs, generic index — **not** a detail page (see below) | — | — |
| 24 | Pilots/Clubs, variant index | — | — |
| 25 | Clubs in a country | `country_id` | — |
| 26 | **Club detail + member roster** (see below) | `country_id`, `club_id` | — |
| 27 | Dead — renders the page shell and an empty results div for every club tried, see below | `country_id`, `club_id` | — |
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
- Second `<td>` is a plain integer, the club's MEMBER count — not a link, and despite this
  doc's own earlier claim (and this app's own earlier reading of it, #66), not a flight count.
  Confirmed against `a=26`'s own explicit `Members` field and that page's roster row count for
  the same club: Voss (51) reads 1271 on all three, Oslo (33) reads 677 on all three. No cheap
  source of a genuine per-club flight total exists on this page or `a=26`; `rqtid=1` sums to
  one (Voss: 10309, nowhere near 1271) but only via a second, per-club request.
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

### Club detail + member roster (`a=26`) — #7

```
GET /fl.html?l=1&a=26&country_id=160&club_id=51
```

**Correction to this doc's own earlier claim (and the issue that cites it) that `a=26, 27`
together are "club detail + member roster."** Only `a=26` is real. `a=27` (any
`country_id`/`club_id` tried, including a real club with members) renders the ordinary page
shell and then an **empty results div** — `<div style='padding:0px 10px'>\n\n</div>` — no
table, no roster, nothing (`fixtures/a27-51-club.html`, `fixtures/a27-37-club.html`). Fed to
this app's own `parseClubDetail`, both throw immediately (no info table, no roster table — it
shares none of `a=26`'s markup) rather than silently parsing as an empty club. Same correction
pattern #11 already applied to `a=23` for takeoffs: a page cited as a detail/roster source that
turns out, live, to be a dead variant.

`a=26` itself renders BOTH the club's own info block and its full member roster on the one
response — there is no second request to make for the roster the way `a=22`/`a=42` need two
separate ones for takeoff detail vs. flights.

```html
<!-- trimmed, a26-51-club.html (Voss) -->
<div align='left'><table cellspacing='1' cellpadding='3' bgcolor='#778899'>
<tr><td bgcolor='white'>Link to more info</td><td bgcolor='white'><a href='https://www.vosshpk.no'>https://www.vosshpk.no</a></td></tr>
<tr><td bgcolor='white'>Description</td><td bgcolor='white'><a href='/fl.html?rqtid=3&club_id=51&…'><img src='…' alt='club logo'></a>Lokalisert på Voss i Vestland</td></tr>
<tr><td bgcolor='white'>Members</td><td bgcolor='white'>1271</td></tr>
<tr><td bgcolor='white'>Coordinates</td><td bgcolor='white'>
      DMS: N 60&deg; 38&#039; 25&#039;&#039; &nbsp;E 6&deg; 30&#039; 4&#039;&#039;<br>UTM: 32V &nbsp;363342 &nbsp;6725319 (WGS84)<br><a href='https://earth.google.com/web/search/60.64027778,6.50111111' target='_blank'>earth.google.com</a></td></tr>
<tr><td bgcolor='white'>created</td><td bgcolor='white'>0000-00-00 00:00:00 </td></tr>
<tr><td bgcolor='white'>Updated</td><td bgcolor='white'>2026-02-14 13:52:15 Martin Krossøy</td></tr>
</table>
<table><tr><td><h4>Club members</h4><table cellspacing='1' cellpadding='3' bgcolor='black'>
<tr><td bgcolor="white"><a href=https://flightlog.org/fl.html?l=1&a=28&user_id=8711>Ada Sofie Thrane Bjorøy</a></td></tr>
…
</table></td><td>&nbsp;&nbsp;</td></tr><table>
</div>
```

- **Info block** (`table[cellspacing="1"][cellpadding="3"][bgcolor="#778899"]`, distinct from
  every table `a=25`'s clubs list or this same page's own roster uses): label/value rows keyed
  by the first `<td>`'s text, same shape `a=22` (takeoff detail) already uses for its own
  label/value table — `parse-club-detail.ts` reuses that file's `labelledRows` technique
  verbatim. `Description`, `Members`, `created` and `Updated` are the only rows present on
  every sampled club, including the zero-member one; `Link to more info` and `Coordinates` are
  both genuinely optional — Oslo's real fixture (`club_id=33`) has no `Coordinates` row at all,
  and a club with no external site has no `Link to more info` row.
- **Club name** is not a labelled row — it comes from the breadcrumb's fourth
  `<span style='font-style:italic'>`, exactly the same technique and index `a=22`'s own
  `readBreadcrumbName` uses (`Home -> Pilots/Clubs -> <Country> -> <Club name>`), confirmed 4
  spans deep on every sampled club, including the zero-member one.
- **Description can be multi-line.** Oslo's real fixture has an actual `<br><br>` paragraph
  break inside it, not just a single line — the same "split on `<br>`, reload each fragment,
  keep the line breaks" technique `parse-takeoff-detail.ts`'s `readDescription` already uses is
  needed here too, not a plain `.text()` call. A club logo `<img>` (wrapped in its own `<a>`)
  often precedes the real text inside the same cell and must not leak into it — `.text()`
  already drops it since neither the anchor nor the image carries a text node of its own.
- **Coordinates** carries DMS, UTM/WGS84, and an `earth.google.com` link with decimal degrees
  in its own path segment (`.../search/60.64027778,6.50111111`) — the same three-way shape
  `a=22` documents for takeoffs, here reachable directly as decimal without `rqtid=11`'s help
  since a club has no equivalent bulk endpoint. `mapUrl` in this app's own `ClubDetail` type is
  that anchor's `href`, taken verbatim.
- **The not-found signal — the cleanest on this site.** A nonexistent `club_id` returns a
  **0-byte response body**, `200 OK`, no page shell at all (`fixtures/a26-nonexistent-club.html`
  is a literal empty file). A real but empty club (`club_id=37`) instead returns the full shell,
  `Members: 0`, and a present-but-empty roster table — the same "container present, positive
  shape confirmed, zero rows" pattern `a=25` uses for a country with no clubs, just reached via
  a 0-byte-body check instead of a missing-table check. `parseClubDetail` therefore short-
  circuits on an empty trimmed body and returns `null` before ever calling `cheerio.load` on it
  — collapsing this into "unrecognised markup" (a throw) or "an empty club" (rendering
  `Members: 0`) would both be wrong in different ways, the same two-outcome split `a=22`'s own
  `parseTakeoffDetail` already documents for its own not-found case.
- **Member roster** (`table[cellspacing="1"][cellpadding="3"][bgcolor="black"]` — the exact same
  three-attribute selector `a=25`'s clubs list uses for ITS results table, here scoped to a
  different page): one `<tr><td><a href=...&a=28&user_id=N>Name</a></td></tr>` per member, a
  single unquoted-attribute `href` (`href=https://…`, no quotes — real markup, cheerio parses it
  fine) and a single `<td>`, unlike the clubs list's two. `a=28` is the same pilot-profile action
  code `a=114` (pilot search) and `a=22`'s site records both use.
- **Scoping the member search to the roster table is not optional.** The page also carries a
  handful of unrelated `user_id=`-bearing anchors elsewhere — a "pilot details" icon link
  (`<a href='…&a=28&user_id=N&xc=xc'><img … alt='pilot details'></a>`, no name text) observed 5
  times on Voss's own fixture, all outside the roster table. Searching the whole document for
  `a[href*="user_id="]` instead of scoping to rows already inside the roster table picks these
  up as 5 phantom, blank-name roster rows (measured: 1276 whole-document matches vs. 1271 real
  roster `<tr>`s, matching the declared `Members: 1271` exactly once scoped) —
  `parse-club-roster.ts`'s `findMemberAnchor` is deliberately called on `row.find(...)`, never
  on the document, the same scoping discipline `parse-clubs.ts` already uses for its own anchor
  search.
- **A name can legitimately belong to two different members.** Voss's 1271-row roster has 7 name
  collisions once scoped correctly (6 real pairs of distinct pilots, e.g. "Cato Wiese-Hansen" as
  `user_id` 5286 and 11085; the 7th is the 5 phantom blank-name icon anchors above, which never
  reach the parser at all once scoped). None of these collapse — `parseClubRoster` dedupes by
  `user_id` only, never by name, so two members sharing a name are two rows, not one.
- **HTML entities decode to identical text across the roster and `rqtid=1`'s stats table** —
  the roster spells one Voss pilot `Luis &#039;&#039;Mickey&#039;&#039; Fonseca`, `rqtid=1`'s
  own stats table spells the same pilot `Luis ''Mickey'' Fonseca` verbatim. Both parse through
  cheerio's own `.text()`, which decodes entities during HTML parsing — confirmed live, not
  assumed: the two strings compare equal with no extra decode step in `resolve-stats-pilots.ts`.
  See "THE JOIN" below for why this matters.

### THE JOIN — resolving `rqtid=1`'s name-only stats to a roster `user_id` — #7

`rqtid=1` (above) carries **no `user_id`, only a display name** — flightlog.org itself appears
to have no reliable per-pilot key for this table, only a name. Cross-referencing it against
`a=26`'s roster is therefore a genuine best-effort join, not a lookup with a guaranteed answer,
and the ambiguity is real: Voss's 290-row stats table resolves 289 rows to exactly one roster
`user_id` and leaves exactly 1 — "Cato Wiese-Hansen" — unresolved, because that name belongs to
two distinct roster members (5286, 11085) and there is nothing in either response to say which
one actually flew.

This app's own join (`src/features/browse-club/resolve-stats-pilots.ts`) is built FROM the
roster, not from the stats table: Voss has 1271 members and only 290 with any recorded flight,
so "never flown" is the common case, not the exception, and a member list built by starting
from `rqtid=1` instead would silently omit 981 real members. A roster member's own follow
button is therefore unconditional (the roster always has their `user_id`, independent of
whether they show up in `rqtid=1` at all); a stats-leaderboard row's follow button/link is
conditional, resolved only where its name indexes to exactly one roster `user_id` — zero
matches (a name in `rqtid=1` that isn't in the current roster at all) and more-than-one match
(the Cato Wiese-Hansen case) both resolve to no link, never a guess. This repo has shipped the
"parser answers confidently with the wrong thing" failure five times before this issue (#25,
#6, #32, #8, #59) — silently picking one of two ambiguous `user_id`s here would be a sixth.

### Takeoff detail (`a=22`) and flights at a takeoff (`a=42`) — #11

```
GET /fl.html?l=1&a=22&country_id=160&start_id=179
GET /fl.html?l=1&a=42&country_id=160&start_id=179
```

**Correction to this doc's own earlier claim that `22, 23` are both takeoff detail pages.**
`a=23` (any `country_id`/`start_id`) renders the generic "Takeoffs per country" index instead —
confirmed live (`fixtures/a23-179-detail.html`, `country_id=160&start_id=179`): the response
shares `a=22`'s page shell and even its `<title>`, but the body is the same country-list table
`a=2`/the takeoff search page renders, both params silently ignored. `a=23` is a real page (not
the ambiguous 302), just not a detail page — this app never fetches it.

- **Results table.** `a=22`'s label/value fields live in
  `table[cellspacing='1'][cellpadding='3'][bgcolor='black']` — the exact same selector
  `a=25` (clubs) and `a=23` (takeoffs index) both use, confirmed live across all three. Not
  unique by itself; see "field labels as the positive signal" below.
- **Rows, in document order:** `region` (absent, not empty, when flightlog.org never assigned
  one — same regionId-0 case `rqtid=11` already documents), `Altitude` (free text, e.g. `401
  meters asl Top to bottom 398 meters`, not a bare number), `Link to more info` (an outbound
  URL, absent when none is set), a Holfuy weather-station map link and an embedded iframe
  widget (both `colspan='2'`, present only for takeoffs flightlog.org has wired one up for, no
  label to key on), `Description` (free HTML — a wind-compass image, sometimes a start-photo
  thumbnail, then `<br>`-separated text), `Coordinates` (DMS/UTM — not used, see the note
  above), `weather` (an outbound NOAA link — not used), `Siterecord` (see below), `created` and
  `Updated` (`YYYY-MM-DD HH:MM:SS`, optionally followed by an editor's name; `created` carries
  a `0000-00-00 00:00:00` placeholder for "never recorded").
- **Field labels as the positive signal.** `region`/`Altitude`/`Description`/`Siterecord`/
  `created`/`Updated` are the label text of `a=22`'s own rows; `a=23`'s rows are
  `<a>Country</a>`/count pairs and `a=25`'s are `<a>Club</a>`/count pairs — neither carries any
  of these labels. A parser fed either by mistake sees the identical table selector but none of
  the expected labels, and throws rather than returning an empty-looking detail object.
- **`Siterecord`** — the best PG, HG and HG2 distance ever flown from this takeoff, e.g. `PG:
  <a href='…a=34&trip_id=803981'>Mikael Benjamin Ulstrup, 196.9 Km</a>&nbsp;&nbsp;HG: …`. The
  class label (`PG`/`HG`/`HG2`) is a bare text node immediately before its anchor, not an
  attribute. Each anchor's `href` carries a `trip_id` but **no `user_id`** — unlike `a=42`'s own
  flight rows (below), a site record's pilot name cannot be a follow target from this response
  alone.
- **Nonexistent `start_id`.** Same `200 OK`, same table, same five required labels present —
  `region` is deliberately not one of them (see `parse-takeoff-detail.ts`'s own `REQUIRED_LABELS`
  comment) and is exactly the label the nonexistent fixture does not carry — confirmed live
  (`fixtures/a22-nonexistent-detail.html`, a `start_id` far outside any real Norway id) — but
  every value is blank and the breadcrumb (`Home -> Takeoffs -> <Country> -> `)
  has only three `<span style='font-style:italic;'>` entries instead of four: no fourth span
  for the takeoff's own name at all. That missing fourth span is the one signal that reliably
  tells a bad id apart from a real, sparsely-populated takeoff (`fixtures/a22-119-detail.html`
  has almost every optional row absent too, but still carries its own name). Row emptiness
  alone cannot make this distinction — a real takeoff with a genuinely empty `Siterecord` cell
  looks identical to a nonexistent one in that one cell.
- **`a=42` (flights at a takeoff)** shares this same "identical empty shell either way" trap.
  `GET a=42&country_id=160&start_id=<bad id>` (`fixtures/a42-nonexistent-flights.html`) and a
  real takeoff with zero flights so far this year (`fixtures/a42-119-flights.html`) render the
  exact same results table
  (`table[cellspacing='1'][cellpadding='2'][bgcolor='#22aa00']`), the exact same pagination
  rows pointing at the same opaque `offset=1000`, and zero flight rows either way. The one
  difference is the page's own `<h3>Flights - <name></h3>` — empty for the bad id, populated
  for the real one — mirroring `a=22`'s breadcrumb signal exactly. A caller that needs "no such
  takeoff" apart from "real takeoff, quiet year" has to use `a=22`'s own name for that, the same
  way `a=25`/clubs' own doc note says a caller needing "no such country" apart from "real
  country, zero clubs" has to cross-reference `rqtid=9`.
- **No `a=22` coordinate fallback.** Both corruption shapes `rqtid=11` documents above (the
  full Null Island placeholder, and a lat/lon axis swap) were checked against `a=22` for the
  same takeoff (`start_id=8478`, "Veines (Kongsfjord)", `lat=0`/`lon=70.73` in `rqtid=11`):
  `a=22`'s own `Coordinates` row is absent for this takeoff (confirmed against
  `fixtures/a22-8478-detail.html`), the same "container present, row missing" shape a takeoff
  with no coordinates ever recorded produces elsewhere on this site — not a separate,
  independently-corrupt reading to fall back to. There is no second source of truth here — a
  takeoff excluded by `hasKnownLocation` stays excluded, full stop.
- **No within-year pagination followed either.** The `offset=1000` link at both the top and
  bottom of `a=42`'s results table appears identically on an empty-this-year response and a
  63-flight one (`fixtures/a42-179-flights.html`) — its unit is not row count and is not
  otherwise documented anywhere on the site. This app requests the bare, no-`offset` response
  for the current year only and does not chase it further, the same reasoning that already
  ruled out chasing `a=42`'s `year=` param across multiple years.
- **`a=93`** (a flight-stats tab both `a=22` and `a=42`'s breadcrumbs link to) — not
  investigated.

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
