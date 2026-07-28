// Generic country-id URL-segment format logic — no curation opinion. Split out of
// curated-countries.ts so curation depends on format, never the reverse: the clubs page
// (`/countries/[countryId]`) needs this parser for every real country id, not just a curated
// one, and importing it from a module named for curation had the dependency arrow backwards —
// curation is a policy layered on top of "is this a well-formed id", not the other way round.
//
// `Number(raw)` alone accepts far more spellings than the URL segments this app itself ever
// produces: hex (`0xA0`), octal/binary (`0o240`/`0b10100000`), exponential (`1.6e2`), a
// leading `+`, surrounding whitespace, and a trailing `.` all normalise to 160 under `Number`
// but are none of them the string `generateStaticParams` enumerated or any real link in this
// app emits. Each distinct spelling is also a distinct URL and therefore a distinct CDN cache
// key, so accepting them all turns a prerendered route back into an anonymous trigger for the
// very request-time fetch prerendering exists to avoid — see the takeoffs API route's own doc
// comment. Requiring a canonical decimal string BEFORE calling `Number` closes that.
const CANONICAL_DECIMAL_ID = /^(0|[1-9]\d*)$/

// The regex alone still lets two distinct spellings collide on one `Number` once the digit
// count exceeds what an IEEE-754 double can represent exactly: '99999999999999999999' (20
// nines) and '100000000000000000000' both match the regex and both `Number()` to the same
// 1e20, so both would resolve to one cache tag. A `String(id) === raw` round-trip check does
// NOT close this on its own — '100000000000000000000' happens to be the exact string
// `String(1e20)` produces, so it round-trips clean even though the underlying double is not
// exact at that magnitude and a neighbouring value ('99999999999999999999') collides onto it.
// `Number.isSafeInteger` is the guard that actually matters: it is false for both, and for
// every digit string past 2^53-1 (Number.MAX_SAFE_INTEGER, 16 digits) regardless of which
// specific value a lossy round trip happens to land on. No real link in this app produces an
// id anywhere near that magnitude, but the guard is now true of every input, not just the
// ones anyone happened to try.
export function parseCanonicalCountryId(raw: string): number | null {
  if (!CANONICAL_DECIMAL_ID.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}
