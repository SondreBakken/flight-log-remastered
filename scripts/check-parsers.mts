import { existsSync, readFileSync } from 'node:fs'
import { parseFlights, parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import { parseCountries } from '../src/lib/flightlog/parse-countries'
import { parseClubs } from '../src/lib/flightlog/parse-clubs'
import { parsePilotSearch } from '../src/lib/flightlog/parse-pilot-search'

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

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
