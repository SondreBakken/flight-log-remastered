import { parseCanonicalCountryId } from './country-id'

// The only flightlog.org countries this app has measured and chosen to prerender a
// takeoffs dataset for (see #38's decision comment on the issue, and the takeoffs API
// route's own doc comment for the mechanism this backs). `countries.ts` already documents
// that a flightlog.org outage during build fails the deploy rather than one page —
// enumerating all ~240 countries here would multiply that cost by 240, for payloads nobody
// has measured. Adding a country is a one-line change to this array, once its payload has
// actually been sized, not a new mechanism.
//
// `expectedRowCountRange` and `expectedPayloadBytes` both bound check-takeoffs-prerender.mts's
// assertion against the prerendered artifact — but they are not the same kind of pin, and that
// difference is deliberate (#55).
//
// The artifact this check reads is populated by a REAL BUILD fetching flightlog.org LIVE, not
// by fixtures/takeoffs-<id>.html — the fixture only exists to have *once* observed this
// country's shape (field order, a plausible size, a plausible row count) at curation time.
// A pin between two things that both come from the fixture (check:parsers' hardcoded row
// counts, for example) is stable forever, because both sides move together or not at all. A
// pin between something frozen at curation time and something fetched live on every build is a
// countdown: Norway's live takeoff count only grows as pilots log new sites, so an exact
// `expectedRowCount` pin here went stale the first time someone logged a takeoff after the
// fixture was captured (#55) — nothing was broken, the check was just asserting a snapshot
// against a moving target.
//
// `expectedRowCountRange` accepts that growth instead of fighting it: a floor and a ceiling,
// not an exact match. Still an ABSOLUTE pin, not one live-computed value compared against
// another — a parser regression that returns a handful of rows, or a route that starts
// serving some unrelated multiple of the real count, lands miles outside this band; ordinary
// people logging ordinary flights over ordinary time does not. Chosen wide enough that it
// should not need touching for a long time: floor is the observed 6012 minus enough room to
// still catch a parser silently dropping most rows, ceiling is enough headroom for years of
// organic growth at Norway's observed pace (one new takeoff between #55 being filed and its
// fix landing) while still catching a parser or route returning garbage at a wildly wrong
// order of magnitude. `expectedPayloadBytes` is intentionally NOT widened to match — see its
// own note below.
//
// `expectedPayloadBytes` is a coarse sanity band on the artifact's total serialised size, NOT
// a field-shape guard: it exists to catch the artifact being grossly wrong (truncated,
// swapped for unrelated content, empty when it shouldn't be) at a granularity byte-counting
// can actually see. It is not a reliable single-field add/drop detector on its own — measured,
// an eleventh field re-added to every row (e.g. countryId duplicated, TAKEOFF_ROW_LENGTH
// bumped to 11 in step) serialises this fixture to 437,776 bytes, which a loosely-drawn band
// would happily accept. The row-length assertion and isTakeoffRows guard in
// check-takeoffs-prerender.mts are what deterministically catch a field silently added to or
// dropped from every row; this band is a backstop underneath those, not a replacement for
// them. The range below (405,000-425,000, ~2% either side of the observed 413,728 bytes) is
// tight enough that it also happens to reject every field-mutation measured against this
// fixture so far, but that is incidental to its job, not the reason it exists. It crosses the
// same frozen-vs-live boundary as the row count and will, eventually, need the same kind of
// widening as Norway's live dataset grows past roughly 6175 rows (~163 rows' worth of bytes
// above the ceiling) — out of scope for #55, which is about the pin that had already gone
// stale, not the one still years from doing so.
export const CURATED_TAKEOFF_COUNTRIES: readonly { countryId: number; expectedRowCountRange: readonly [number, number]; expectedPayloadBytes: readonly [number, number] }[] = [
  { countryId: 160, expectedRowCountRange: [5500, 9000], expectedPayloadBytes: [405_000, 425_000] }, // Norway, ~970 KB upstream (fixtures/takeoffs-160.html)
]

// `readonly number[]`, not a `readonly [160]` tuple: every caller either maps over this or
// checks membership with `.includes`, neither of which benefits from literal-type narrowing,
// and the tuple form fights `.includes(id: number)` for no real gain.
export const CURATED_TAKEOFF_COUNTRY_IDS: readonly number[] = CURATED_TAKEOFF_COUNTRIES.map((c) => c.countryId)

// The id-format guard itself (`parseCanonicalCountryId`) lives in `./country-id` — it has no
// curation opinion, so curation depends on format here, not the other way round. Only the
// exact spelling `generateStaticParams` produces (`String(countryId)`, e.g. `"160"`) is
// accepted for a curated id; see that module's own doc comment for why no alias spelling is
// accepted for ANY id, curated or not.
export function parseCuratedCountryId(raw: string): number | null {
  const id = parseCanonicalCountryId(raw)
  return id !== null && CURATED_TAKEOFF_COUNTRY_IDS.includes(id) ? id : null
}

// The countries this app has measured and chosen to prerender a CLUB LIST for (#40) — same
// build-time-outage-risk reasoning as CURATED_TAKEOFF_COUNTRIES above (a flightlog.org outage
// during build fails the deploy rather than one page), kept as its own array rather than
// reusing CURATED_TAKEOFF_COUNTRY_IDS because the two curations answer different questions
// (has this country's TAKEOFF payload been measured and fixture-pinned, vs. has its CLUB
// payload) that happen to coincide today only because both were measured in the same pass.
// Unlike the takeoffs route/page, the clubs page (/countries/[countryId]) does NOT reject an
// uncurated id — see its own doc comment — so this array only decides which ids
// generateStaticParams prerenders, not which ids the page will serve.
//
// Norway's club list (fixtures/clubs-160.html) is a ~22 KB upstream response — small enough,
// and small enough as parsed data (~6 KB), that this build was always going to embed it
// directly in the page's own static output the way the takeoffs page already does for region
// names, rather than spinning up a second fetched-JSON-asset architecture the way #38 did for
// takeoffs' 970 KB. There is no separate JSON artifact on disk to size an
// `expectedPayloadBytes`-shaped band against — the artifact here is a full rendered HTML page
// (hashed asset chunk names and all) — so check-clubs-prerender.mts instead asserts on
// rendered content: the resolved country name (`expectedCountryName`, carried per entry rather
// than hardcoded, since a second curated country would otherwise have the first one's name
// asserted against its own HTML), the club count text, and the actual number of rendered club
// rows (`expectedRowCount`). It does still print the artifact's raw HTML byte count for a
// human skimming the check's output, and `expectedHtmlBytes` turns that into an actual
// assertion, the same coarse-sanity-band role `expectedPayloadBytes` plays above — not a
// field-shape guard, just wide enough to catch the artifact being grossly wrong (truncated,
// swapped for unrelated content) while tolerating the page shell's own hashed chunk names and
// whitespace moving between Next.js versions.
//
// `expectedRowCount: 91` below is pinned against the LIVE build by check-clubs-prerender.mts
// on every machine that runs `pnpm run check` — that is the assertion actually load-bearing in
// CI and on a clean checkout. check-parsers.mts's fixtures/clubs-160.html fixture pins the same
// 91 too, but only on a machine where `fixtures/` has been manually regenerated locally (see
// README's Fixtures section) — fixtures/ is gitignored and absent on a clean checkout, and
// check:parsers SKIPs (exit 0), not fails, when it's missing. So on any machine without that
// manual step — which includes CI — 91 is pinned by the live prerender check alone.
export const CURATED_CLUB_COUNTRIES: readonly {
  countryId: number
  expectedCountryName: string
  expectedRowCount: number
  expectedHtmlBytes: readonly [number, number]
}[] = [
  // see fixtures/clubs-160.html, docs/flightlog-api.md. expectedHtmlBytes is a wide band
  // (roughly ±25% of the observed 53,192 bytes) rather than a tight one like
  // expectedPayloadBytes above: this artifact is a full rendered HTML page shell, including
  // hashed asset chunk names that shift on every dependency or Next.js bump, not a stable
  // JSON payload — the content assertions below are what actually pin correctness.
  { countryId: 160, expectedCountryName: 'Norway', expectedRowCount: 91, expectedHtmlBytes: [40_000, 66_000] },
]

export const CURATED_CLUB_COUNTRY_IDS: readonly number[] = CURATED_CLUB_COUNTRIES.map((c) => c.countryId)
