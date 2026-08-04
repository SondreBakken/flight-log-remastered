import { parseCanonicalCountryId } from './country-id'

// The only flightlog.org countries this app has measured and chosen to prerender a
// takeoffs dataset for (see #38's decision comment on the issue, and the takeoffs API
// route's own doc comment for the mechanism this backs). `countries.ts` already documents
// that a flightlog.org outage during build fails the deploy rather than one page —
// enumerating all ~240 countries here would multiply that cost by 240, for payloads nobody
// has measured. Adding a country is a one-line change to this array, once its payload has
// actually been sized, not a new mechanism.
//
// This file is CURATION only: which ids the app itself prerenders and serves
// (parseCuratedCountryId gates a real route). The bands and literals that check-takeoffs-
// prerender.mts / check-clubs-prerender.mts assert the resulting artifact against live in
// `scripts/lib/curated-country-expectations.ts` instead (#55) — nothing under `src/` reads
// them, only those two check scripts do, so they were config for a check, not a curation
// decision, and didn't belong mixed in here. See that file, and docs/testing.md's "Frozen pins
// vs. live pins" section, for what each expectation bounds and why.
//
// `readonly number[]`, not a `readonly [160]` tuple: every caller either maps over this or
// checks membership with `.includes`, neither of which benefits from literal-type narrowing,
// and the tuple form fights `.includes(id: number)` for no real gain.
export const CURATED_TAKEOFF_COUNTRY_IDS: readonly number[] = [160] // Norway, ~970 KB upstream (fixtures/takeoffs-160.html)

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
// build-time-outage-risk reasoning as CURATED_TAKEOFF_COUNTRY_IDS above (a flightlog.org
// outage during build fails the deploy rather than one page), kept as its own array rather
// than reusing CURATED_TAKEOFF_COUNTRY_IDS because the two curations answer different
// questions (has this country's TAKEOFF payload been measured and fixture-pinned, vs. has its
// CLUB payload) that happen to coincide today only because both were measured in the same
// pass. Unlike the takeoffs route/page, the clubs page (/countries/[countryId]) does NOT
// reject an uncurated id — see its own doc comment — so this array only decides which ids
// generateStaticParams prerenders, not which ids the page will serve. Its check-time
// expectations (country name, club-count pin, HTML byte band) live in
// `scripts/lib/curated-country-expectations.ts`, same split and same reason as the takeoffs
// array above.
export const CURATED_CLUB_COUNTRY_IDS: readonly number[] = [160] // Norway
