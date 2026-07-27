// The only flightlog.org countries this app has measured and chosen to prerender a
// takeoffs dataset for (see #38's decision comment on the issue, and the takeoffs API
// route's own doc comment for the mechanism this backs). `countries.ts` already documents
// that a flightlog.org outage during build fails the deploy rather than one page —
// enumerating all ~240 countries here would multiply that cost by 240, for payloads nobody
// has measured. Adding a country is a one-line change to this array, once its payload has
// actually been sized, not a new mechanism.
//
// `expectedRowCount` and `expectedPayloadBytes` are both observed for this exact fixture at
// curation time (fixtures/takeoffs-<id>.html) — the single source of truth
// check-takeoffs-prerender.mts asserts the prerendered artifact against, so a build silently
// serving another country's rows, or a truncated/corrupted artifact, fails even if it happens
// to parse as a well-formed array of the right length. Expected to need a one-line bump if
// the fixture is ever regenerated against a since-changed upstream dataset — same as
// check:parsers' own hardcoded row counts.
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
// fixture so far, but that is incidental to its job, not the reason it exists.
export const CURATED_TAKEOFF_COUNTRIES: readonly { countryId: number; expectedRowCount: number; expectedPayloadBytes: readonly [number, number] }[] = [
  { countryId: 160, expectedRowCount: 6012, expectedPayloadBytes: [405_000, 425_000] }, // Norway, ~970 KB upstream (fixtures/takeoffs-160.html)
]

// `readonly number[]`, not a `readonly [160]` tuple: every caller either maps over this or
// checks membership with `.includes`, neither of which benefits from literal-type narrowing,
// and the tuple form fights `.includes(id: number)` for no real gain.
export const CURATED_TAKEOFF_COUNTRY_IDS: readonly number[] = CURATED_TAKEOFF_COUNTRIES.map((c) => c.countryId)

// `Number(raw)` alone accepts far more spellings than the URL segments this app itself ever
// produces: hex (`0xA0`), octal/binary (`0o240`/`0b10100000`), exponential (`1.6e2`), a
// leading `+`, surrounding whitespace, and a trailing `.` all normalise to 160 under `Number`
// but are none of them the string `generateStaticParams` enumerated or any real link in this
// app emits. Each distinct spelling is also a distinct URL and therefore a distinct CDN cache
// key, so accepting them all turns the prerendered route back into an anonymous trigger for
// the very request-time `getTakeoffs` fetch prerendering exists to avoid — see the takeoffs
// API route's own doc comment. Requiring a canonical decimal string BEFORE calling `Number`
// closes that: only the exact spelling `generateStaticParams` produces (`String(countryId)`,
// e.g. `"160"`) is accepted, so every alias falls through to the same 404 an uncurated id
// gets. Shared by the route and the page — see both files' own doc comments for why they
// each need this independently, Cache Components having removed `dynamicParams = false`.
const CANONICAL_DECIMAL_ID = /^(0|[1-9]\d*)$/

export function parseCuratedCountryId(raw: string): number | null {
  if (!CANONICAL_DECIMAL_ID.test(raw)) return null
  const id = Number(raw)
  return CURATED_TAKEOFF_COUNTRY_IDS.includes(id) ? id : null
}
