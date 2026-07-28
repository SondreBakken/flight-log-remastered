import { existsSync, readFileSync } from 'node:fs'
import { parseFlights, parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import { parseCountries } from '../src/lib/flightlog/parse-countries'
import { parseClubs } from '../src/lib/flightlog/parse-clubs'
import { parsePilotSearch } from '../src/lib/flightlog/parse-pilot-search'
import { parseTakeoffs } from '../src/lib/flightlog/parse-takeoffs'
import { parseRegions } from '../src/lib/flightlog/parse-regions'
import { parseTakeoffDetail } from '../src/lib/flightlog/parse-takeoff-detail'
import { parseTakeoffFlights } from '../src/lib/flightlog/parse-takeoff-flights'
import { encodeTakeoffRow, isTakeoffRows } from '../src/app/api/countries/[countryId]/takeoffs/contract'

// fixtures/ is gitignored (scraped pages carry personal data — see README), so it does not
// exist in a clean checkout or in CI. That must not fail the gate: it means "nothing to
// check here," not "something is broken." A missing-fixtures exit code of 1 previously made
// this indistinguishable from a real assertion failure, and this check was never wired into
// `pnpm run check` at all — so in practice it silently never ran either way. Skip loudly
// (still visible in the log) and exit 0; a fixture that IS present and wrong below still
// fails the gate for real.
const requiredFixtures = [
  'fixtures/pilot-12677.html',
  'fixtures/pilot-4549.html',
  'fixtures/track-1001428.kml',
  'fixtures/countries.html',
  'fixtures/clubs-160.html',
  'fixtures/clubs-29.html',
  'fixtures/pilot-search-form.html',
  'fixtures/pilot-search-grouped.html',
  'fixtures/pilot-search-zero.html',
  'fixtures/takeoffs-160.html',
  'fixtures/takeoffs-29.html',
  'fixtures/regions-160.html',
  'fixtures/regions-29.html',
  'fixtures/a22-179-detail.html',
  'fixtures/a22-119-detail.html',
  'fixtures/a22-8478-detail.html',
  'fixtures/a22-nonexistent-detail.html',
  'fixtures/a23-179-detail.html',
  'fixtures/a42-179-flights.html',
  'fixtures/a42-119-flights.html',
  'fixtures/a42-nonexistent-flights.html',
]
const missing = requiredFixtures.filter((f) => !existsSync(f))
if (missing.length > 0) {
  console.log(
    `SKIP - check:parsers: missing ${missing.join(', ')}\n` +
      'These are gitignored scraped pages, not present in a clean checkout. Regenerate ' +
      'them locally per the README "Fixtures" section to actually exercise the parsers.',
  )
  process.exit(0)
}

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

const pilotFixtures = [
  ['fixtures/pilot-12677.html', 12677],
  ['fixtures/pilot-4549.html', 4549],
] as const

for (const [file, userId] of pilotFixtures) {
  const html = readFileSync(file, 'utf8')
  const pilot = parsePilot(html, userId)
  const flights = parseFlights(html, userId)
  console.log(`${file}: pilot=${pilot.name} flights=${flights.length} missingTakeoff=${flights.filter((f) => !f.takeoff).length}`)
  assert(pilot.name.trim() !== '', `${file}: pilot name is non-empty`)
  assert(flights.length > 0, `${file}: parses at least one flight`)
}

const track = parseTrack(readFileSync('fixtures/track-1001428.kml', 'utf8'), 1001428)
console.log(`track 1001428: points=${track.points.length} maxAlt=${track.stats.maxAltitude} duration=${track.stats.duration}`)
assert(track.points.length > 0, 'track 1001428: parses at least one point')
assert(track.stats.maxAltitude !== null, 'track 1001428: parses a max altitude')

const countries = parseCountries(readFileSync('fixtures/countries.html', 'utf8'))
const norway = countries.find((country) => country.countryId === 160)
console.log(`countries.html: countries=${countries.length} norway=${norway?.name ?? 'MISSING'}`)
assert(countries.length === 240, `countries.html: parses all 240 countries (got ${countries.length})`)
assert(norway?.name === 'Norway', `countries.html: country id 160 resolves to Norway (got ${norway?.name ?? 'MISSING'})`)

const clubs = parseClubs(readFileSync('fixtures/clubs-160.html', 'utf8'), 160)
console.log(`clubs-160.html: clubs=${clubs.length} sample=${clubs[0]?.name}`)
assert(clubs.length === 91, `clubs-160.html (Norway): parses all 91 clubs (got ${clubs.length})`)

const emptyClubs = parseClubs(readFileSync('fixtures/clubs-29.html', 'utf8'), 29)
console.log(`clubs-29.html (Bouvet Island): clubs=${emptyClubs.length}`)
assert(emptyClubs.length === 0, `clubs-29.html (Bouvet Island): genuinely zero clubs (got ${emptyClubs.length})`)

// pilot-search-form.html is a=114's bare GET form: no query submitted, so it has zero candidate
// rows AND no "-1 No match found" banner (that banner only renders on a POST response, zero-
// match or otherwise). Production only ever parses POST responses, never this page, so it is
// correct — not a regression — for the parser to throw here: zero candidates without the banner
// is exactly the shape markup drift produces, and this page can't be told apart from that by the
// parser alone.
let formPageThrew = false
try {
  parsePilotSearch(readFileSync('fixtures/pilot-search-form.html', 'utf8'))
} catch {
  formPageThrew = true
}
console.log(`pilot-search-form.html: threw=${formPageThrew}`)
assert(formPageThrew, 'pilot-search-form.html: bare GET form page (never parsed in production) throws rather than parsing as zero results')

const groupedSearch = parsePilotSearch(readFileSync('fixtures/pilot-search-grouped.html', 'utf8'))
const norwayHits = groupedSearch.filter((result) => result.country === 'Norway')
console.log(`pilot-search-grouped.html: results=${groupedSearch.length} norway=${norwayHits.length}`)
assert(groupedSearch.length === 407, `pilot-search-grouped.html (user_fullname=nde): parses all 407 rows (got ${groupedSearch.length})`)
assert(norwayHits.length > 0, `pilot-search-grouped.html: at least one Norway hit (got ${norwayHits.length})`)

const zeroMatchSearch = parsePilotSearch(readFileSync('fixtures/pilot-search-zero.html', 'utf8'))
console.log(`pilot-search-zero.html: results=${zeroMatchSearch.length}`)
assert(zeroMatchSearch.length === 0, `pilot-search-zero.html: genuinely zero matches (got ${zeroMatchSearch.length})`)

// Exact equality, deliberately unchanged by #55: both sides here are frozen. `takeoffs` comes
// from parsing THIS fixture file, and 6012 is what that exact, immutable file has always parsed
// to — a fixture-vs-fixture pin like this can't go stale on flightlog.org's schedule, only on a
// deliberate fixture regeneration (see the README's "Fixtures" section), unlike
// check-takeoffs-prerender.mts's row-count band, which compares this same fixture-time number
// against a REAL BUILD's LIVE fetch and had to widen into a range for exactly that reason.
const takeoffs = parseTakeoffs(readFileSync('fixtures/takeoffs-160.html', 'utf8'), 160)
const jordeTakeoff = takeoffs.find((t) => t.takeoffId === 6246)
console.log(`takeoffs-160.html: takeoffs=${takeoffs.length} sample=${jordeTakeoff?.name}`)
assert(takeoffs.length === 6012, `takeoffs-160.html (Norway): parses all 6012 takeoffs (got ${takeoffs.length})`)
assert(
  jordeTakeoff?.name === 'Jorde på Løten, Klæpa airport',
  `takeoffs-160.html: takeoff id 6246 resolves to the expected name (got ${jordeTakeoff?.name ?? 'MISSING'})`,
)

// #38: the real transform (encodeTakeoffRow) run end to end against the full 6012-row
// Norway fixture, not a hand-picked sample — proving the wire shape at the size it will
// actually ship at, not at a size too small to notice a shape regression.
const takeoffRows = takeoffs.map(encodeTakeoffRow)
console.log(`takeoffs-160.html: encoded rows=${takeoffRows.length}`)
assert(takeoffRows.length === 6012, `takeoffs-160.html: encodes all 6012 rows (got ${takeoffRows.length})`)
// 10, not TAKEOFF_ROW_LENGTH: this is meant to catch encodeTakeoffRow and the constant that
// defines its shape drifting apart — say, TAKEOFF_ROW_LENGTH bumped to 11 alongside a new
// field added to the encoder. Importing TAKEOFF_ROW_LENGTH here instead would make that
// exact mutation invisible, since both sides of the comparison would have moved together.
assert(
  takeoffRows.every((row) => row.length === 10),
  'takeoffs-160.html: every encoded row has exactly 10 fields, independent of TAKEOFF_ROW_LENGTH (no dropped or duplicated field, and no field count bumped alongside it)',
)
assert(isTakeoffRows(takeoffRows), 'takeoffs-160.html: every encoded row passes the wire-boundary shape check')

// The payload-size sanity band that used to live here now lives in
// check-takeoffs-prerender.mts (see scripts/lib/curated-country-expectations.ts's
// bytesPerRowRange), asserted against the real build artifact instead of this fixture — this
// script is gated on fixtures/ (gitignored) and therefore never runs in CI on a clean
// checkout, which made the band here invisible where it mattered most. Row count and shape
// are still pinned here, against the fixture, same as everywhere else in this file.

const emptyTakeoffs = parseTakeoffs(readFileSync('fixtures/takeoffs-29.html', 'utf8'), 29)
console.log(`takeoffs-29.html (Bouvet Island): takeoffs=${emptyTakeoffs.length}`)
assert(emptyTakeoffs.length === 0, `takeoffs-29.html (Bouvet Island): genuinely zero takeoffs (got ${emptyTakeoffs.length})`)

const regions = parseRegions(readFileSync('fixtures/regions-160.html', 'utf8'), 160)
const akershusRegion = regions.find((r) => r.regionId === 2)
console.log(`regions-160.html: regions=${regions.length} sample=${akershusRegion?.name}`)
assert(regions.length === 29, `regions-160.html (Norway): parses all 29 regions (got ${regions.length})`)
assert(
  akershusRegion?.name === 'Akershus',
  `regions-160.html: region id 2 resolves to Akershus (got ${akershusRegion?.name ?? 'MISSING'})`,
)

const emptyRegions = parseRegions(readFileSync('fixtures/regions-29.html', 'utf8'), 29)
console.log(`regions-29.html (Bouvet Island): regions=${emptyRegions.length}`)
assert(emptyRegions.length === 0, `regions-29.html (Bouvet Island): genuinely zero regions (got ${emptyRegions.length})`)

const solbergasenDetail = parseTakeoffDetail(readFileSync('fixtures/a22-179-detail.html', 'utf8'), 179)
console.log(
  `a22-179-detail.html: name=${solbergasenDetail?.name} siteRecords=${solbergasenDetail?.siteRecords.length} createdAt=${solbergasenDetail?.createdAt}`,
)
assert(solbergasenDetail?.name === 'Drammen, Solbergåsen', `a22-179-detail.html: resolves the expected name (got ${solbergasenDetail?.name ?? 'MISSING'})`)
assert(solbergasenDetail?.siteRecords.length === 3, `a22-179-detail.html: parses all 3 site records (got ${solbergasenDetail?.siteRecords.length})`)
assert(solbergasenDetail?.createdAt === null, `a22-179-detail.html: normalises the 0000-00-00 placeholder created date to null (got ${solbergasenDetail?.createdAt})`)

const hafstadfjelletDetail = parseTakeoffDetail(readFileSync('fixtures/a22-119-detail.html', 'utf8'), 119)
console.log(`a22-119-detail.html: name=${hafstadfjelletDetail?.name} siteRecords=${hafstadfjelletDetail?.siteRecords.length}`)
assert(hafstadfjelletDetail?.siteRecords.length === 0, `a22-119-detail.html: genuinely zero site records (got ${hafstadfjelletDetail?.siteRecords.length})`)

const veinesDetail = parseTakeoffDetail(readFileSync('fixtures/a22-8478-detail.html', 'utf8'), 8478)
console.log(`a22-8478-detail.html: name=${veinesDetail?.name}`)
assert(veinesDetail?.name === 'Veines (Kongsfjord)', `a22-8478-detail.html: resolves the expected name (got ${veinesDetail?.name ?? 'MISSING'})`)

// The failure mode this repo has hit four times, guarded directly: a nonexistent start_id
// renders the identical table shell a real takeoff does — this must resolve to null (see
// parseTakeoffDetail's own doc comment), never an empty-but-present object and never a throw.
const nonexistentDetail = parseTakeoffDetail(readFileSync('fixtures/a22-nonexistent-detail.html', 'utf8'), 999999999)
console.log(`a22-nonexistent-detail.html: detail=${nonexistentDetail === null ? 'null' : 'NOT NULL'}`)
assert(nonexistentDetail === null, `a22-nonexistent-detail.html: resolves to null, not a throw or an empty-but-present object (got ${JSON.stringify(nonexistentDetail)})`)

const solbergasenFlights = parseTakeoffFlights(readFileSync('fixtures/a42-179-flights.html', 'utf8'), 179)
const missingUserOrTrip = (solbergasenFlights ?? []).filter((f) => !Number.isInteger(f.userId) || !Number.isInteger(f.tripId))
console.log(`a42-179-flights.html: flights=${solbergasenFlights?.length ?? 'NULL'} missingUserOrTrip=${missingUserOrTrip.length}`)
assert(solbergasenFlights?.length === 63, `a42-179-flights.html (Drammen, Solbergåsen): parses all 63 flights (got ${solbergasenFlights?.length ?? 'NULL'})`)
assert(missingUserOrTrip.length === 0, `a42-179-flights.html: every flight carries both user_id and trip_id (got ${missingUserOrTrip.length} missing)`)

// The identity gate (#11's fix round): a real takeoff with zero flights this year (119) still
// names itself in the page's own `<h3>` heading, so it resolves to a genuinely empty array —
// never null, which is reserved for the nonexistent-start_id case immediately below.
const quietTakeoffFlights = parseTakeoffFlights(readFileSync('fixtures/a42-119-flights.html', 'utf8'), 119)
console.log(`a42-119-flights.html (real takeoff, quiet year): flights=${quietTakeoffFlights?.length ?? 'NULL'}`)
assert(quietTakeoffFlights?.length === 0, `a42-119-flights.html: genuinely zero flights this year, not null (got ${JSON.stringify(quietTakeoffFlights)})`)

// The regression this fix round exists to close: a nonexistent start_id must resolve to null
// (the identity gate — see parseTakeoffFlights' own doc comment), never an empty-but-present
// array, which previously left a wrong "no flights" cached for the wrong reason.
const nonexistentTakeoffFlights = parseTakeoffFlights(readFileSync('fixtures/a42-nonexistent-flights.html', 'utf8'), 999999999)
console.log(`a42-nonexistent-flights.html: flights=${nonexistentTakeoffFlights === null ? 'null' : 'NOT NULL'}`)
assert(
  nonexistentTakeoffFlights === null,
  `a42-nonexistent-flights.html: resolves to null via the identity gate, not an empty-but-present array (got ${JSON.stringify(nonexistentTakeoffFlights)})`,
)

// a23 shares a=22's exact results-table selector but none of its REQUIRED_LABELS (see
// parse-takeoff-detail.ts) — cited in docs/flightlog-api.md's "Correction to this doc's own
// earlier claim" note but, until now, never actually exercised against the real captured page.
const a23Throws = (() => {
  try {
    parseTakeoffDetail(readFileSync('fixtures/a23-179-detail.html', 'utf8'), 179)
    return false
  } catch {
    return true
  }
})()
console.log(`a23-179-detail.html: threw=${a23Throws}`)
assert(a23Throws, 'a23-179-detail.html: the real captured a=23 page throws when fed to parseTakeoffDetail, rather than parsing as a detail object')

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
