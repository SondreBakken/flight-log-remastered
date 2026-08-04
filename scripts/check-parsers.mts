import { existsSync, readFileSync } from 'node:fs'
import { parseFlights, parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import { parseCountries } from '../src/lib/flightlog/parse-countries'
import { parseClubs } from '../src/lib/flightlog/parse-clubs'
import { parseClubDetail } from '../src/lib/flightlog/parse-club-detail'
import { parseClubRoster } from '../src/lib/flightlog/parse-club-roster'
import { parseClubStats } from '../src/lib/flightlog/parse-club-stats'
import { resolveStatsPilots } from '../src/features/browse-club/resolve-stats-pilots'
import { parsePilotSearch } from '../src/lib/flightlog/parse-pilot-search'
import { parseTakeoffs } from '../src/lib/flightlog/parse-takeoffs'
import { parseRegions } from '../src/lib/flightlog/parse-regions'
import { parseTakeoffDetail } from '../src/lib/flightlog/parse-takeoff-detail'
import { parseTakeoffFlights } from '../src/lib/flightlog/parse-takeoff-flights'
import { encodeTakeoffRow, isTakeoffRows } from '../src/app/api/countries/[countryId]/takeoffs/contract'
import { joinFlownSites } from '../src/features/browse-flown-sites-map/join-flown-sites'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'
import { hasKnownLocation } from '../src/lib/flightlog/has-known-location'

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
  'fixtures/track-233524.kml',
  'fixtures/track-235690.kml',
  'fixtures/countries.html',
  'fixtures/clubs-160.html',
  'fixtures/clubs-29.html',
  'fixtures/a26-51-club.html',
  'fixtures/a26-33-club.html',
  'fixtures/a26-37-club.html',
  'fixtures/a26-nonexistent-club.html',
  'fixtures/a27-51-club.html',
  'fixtures/a27-37-club.html',
  'fixtures/rqtid1-51.html',
  'fixtures/rqtid1-37.html',
  'fixtures/rqtid1-nonexistent-club.html',
  'fixtures/rqtid1-missing-club-id.html',
  'fixtures/rqtid1-missing-country-id.html',
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
const stats1001428 = track.stats
const stats1001428Display =
  stats1001428 === 'unparseable'
    ? 'unparseable'
    : { maxAlt: stats1001428.maxAltitude, duration: stats1001428.duration }
console.log(`track 1001428: points=${track.points.length} stats=${JSON.stringify(stats1001428Display)}`)
assert(track.points.length > 0, 'track 1001428: parses at least one point')
assert(stats1001428 !== 'unparseable' && stats1001428.maxAltitude !== null, 'track 1001428: parses a max altitude')

// #59: fixed-width label variants across GpsDump export versions. track-233524.kml is GpsDump
// 4.36 and track-235690.kml is GpsDump 4.23 — both 2010-era GpsDump desktop builds, using older
// wording ("Max./min. height", "Max. mean/top speed", the combined "Max/min climb rate ... over
// 60s" line) than the other five sampled fixtures, which are GpsDumpAndroid 2.8.67/2.8.72 (a
// different product line, not a newer version of the same one) — see parse-track.ts's
// readStatLine/parseClimbRates. Every one of these five fields must resolve on both eras, not
// just the newer one. The synthetic "unrecognised label" and "pilot comment can't override a
// stat" cases live in parse-track.test.ts instead of here — hand-built KML, not a fixture, so
// they run in CI on a clean checkout rather than only when fixtures/ happens to be present.
const olderGpsDumpFixtures = [
  ['fixtures/track-233524.kml', 233524],
  ['fixtures/track-235690.kml', 235690],
] as const

for (const [file, tripId] of olderGpsDumpFixtures) {
  const olderTrack = parseTrack(readFileSync(file, 'utf8'), tripId)
  const stats = olderTrack.stats
  console.log(`${file}: stats=${stats === 'unparseable' ? 'unparseable' : JSON.stringify(stats)}`)
  if (stats === 'unparseable') {
    assert(false, `${file}: older GpsDump label wording still resolves to real stats, not 'unparseable'`)
    continue
  }
  assert(stats.maxAltitude !== null, `${file}: "Max./min. height" resolves a max altitude`)
  assert(stats.minAltitude !== null, `${file}: "Max./min. height" resolves a min altitude`)
  assert(stats.maxSpeed !== null, `${file}: "Max. mean/top speed" resolves a max speed`)
  assert(stats.maxClimb !== null, `${file}: the combined "Max/min climb rate" line resolves a max climb`)
  assert(stats.minClimb !== null, `${file}: the combined "Max/min climb rate" line resolves a min climb`)
}

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

// #7's club page. Voss (51) is the largest club on hand: 1271 members, 290 with any recorded
// flight, and 6 real name collisions in the roster (see resolve-stats-pilots.ts's own doc
// comment) — the fixture that actually exercises the ambiguous-name path below.
const vossHtml = readFileSync('fixtures/a26-51-club.html', 'utf8')
const vossDetail = parseClubDetail(vossHtml, 51)
const vossRoster = parseClubRoster(vossHtml, 51)
console.log(
  `a26-51-club.html: name=${vossDetail?.name} members=${vossDetail?.memberCount} roster=${vossRoster.length} mapUrl=${vossDetail?.mapUrl}`,
)
assert(vossDetail?.name === 'Voss Hang- Og Paragliderklubb', `a26-51-club.html: resolves the expected name (got ${vossDetail?.name ?? 'MISSING'})`)
assert(vossDetail?.memberCount === 1271, `a26-51-club.html: Members reads 1271 (got ${vossDetail?.memberCount})`)
assert(vossRoster.length === 1271, `a26-51-club.html: roster carries all 1271 members, matching the declared count (got ${vossRoster.length})`)
assert(
  vossDetail?.mapUrl === 'https://earth.google.com/web/search/60.64027778,6.50111111',
  `a26-51-club.html: extracts the earth.google.com decimal-degree map link (got ${vossDetail?.mapUrl})`,
)

// Oslo (33): the fixture with no Coordinates row at all, confirming that field is genuinely
// optional and not just untested.
const osloDetail = parseClubDetail(readFileSync('fixtures/a26-33-club.html', 'utf8'), 33)
console.log(`a26-33-club.html: name=${osloDetail?.name} members=${osloDetail?.memberCount} coordinatesText=${osloDetail?.coordinatesText}`)
assert(osloDetail?.memberCount === 677, `a26-33-club.html: Members reads 677 (got ${osloDetail?.memberCount})`)
assert(osloDetail?.coordinatesText === null, `a26-33-club.html: a club with no Coordinates row parses coordinatesText as null, not a throw (got ${osloDetail?.coordinatesText})`)

// #66: clubs-160.html's own `a=25` column agreed with itself, its type, and its header — and
// all three disagreed with the data (1271 read as Voss's FLIGHT count, when it is Voss's
// MEMBER count). Internal consistency couldn't catch that; only a second, independently
// labelled source can — `a=26`'s own explicit `Members` field for the SAME club, fetched and
// parsed by an entirely different parser above. Comparing `clubs` (parseClubs, `a=25`) against
// `vossDetail`/`osloDetail` (parseClubDetail, `a=26`) crosses that boundary; comparing
// parseClubs against a fixture-derived expectation, or against itself, would have passed on
// the original bug too.
const vossListRow = clubs.find((club) => club.clubId === 51)
const osloListRow = clubs.find((club) => club.clubId === 33)
console.log(
  `clubs-160.html vs a26: Voss memberCount=${vossListRow?.memberCount} (a26 Members=${vossDetail?.memberCount}), Oslo memberCount=${osloListRow?.memberCount} (a26 Members=${osloDetail?.memberCount})`,
)
assert(
  vossListRow?.memberCount === vossDetail?.memberCount,
  `clubs-160.html: Voss's a=25 memberCount (${vossListRow?.memberCount}) matches a=26's own Members field (${vossDetail?.memberCount}), not flightlog.org's 10309-flight total`,
)
assert(
  osloListRow?.memberCount === osloDetail?.memberCount,
  `clubs-160.html: Oslo's a=25 memberCount (${osloListRow?.memberCount}) matches a=26's own Members field (${osloDetail?.memberCount})`,
)

// Øø Eiken (37): a REAL club with zero members — the case rqtid=1 alone (below) cannot tell
// apart from a nonexistent club_id, and the reason a=26 is this app's only source of truth
// for that distinction.
const eikenHtml = readFileSync('fixtures/a26-37-club.html', 'utf8')
const eikenDetail = parseClubDetail(eikenHtml, 37)
const eikenRoster = parseClubRoster(eikenHtml, 37)
console.log(`a26-37-club.html: detail=${eikenDetail === null ? 'null' : 'present'} members=${eikenDetail?.memberCount} roster=${eikenRoster.length}`)
assert(eikenDetail !== null, 'a26-37-club.html: a real, zero-member club parses as a present ClubDetail, not null')
assert(eikenDetail?.memberCount === 0, `a26-37-club.html: Members reads 0 (got ${eikenDetail?.memberCount})`)
assert(eikenRoster.length === 0, `a26-37-club.html: roster is genuinely empty, not a throw (got ${eikenRoster.length})`)

// The one not-found signal this endpoint has: a 0-byte body, 200 OK, no page shell at all —
// must resolve to null, never render as an empty club (see parseClubDetail's own doc comment).
const nonexistentClubDetail = parseClubDetail(readFileSync('fixtures/a26-nonexistent-club.html', 'utf8'), 999999999)
console.log(`a26-nonexistent-club.html: detail=${nonexistentClubDetail === null ? 'null' : 'NOT NULL'}`)
assert(nonexistentClubDetail === null, `a26-nonexistent-club.html: resolves to null, not a throw or an empty-but-present object (got ${JSON.stringify(nonexistentClubDetail)})`)

// #11's own correction pattern, applied to a=27: the issue and docs/flightlog-api.md both
// claimed a=27 was the member roster; it is dead (renders the page shell plus an empty
// results div for every club tried, live). Feeding it to parseClubDetail throws — it shares
// none of a=26's markup (no info table, no roster table) — proving live that this app is
// right not to fetch it.
const a27Throws = (file: string) => {
  try {
    parseClubDetail(readFileSync(file, 'utf8'), 51)
    return false
  } catch {
    return true
  }
}
console.log(`a27-51-club.html: threw=${a27Throws('fixtures/a27-51-club.html')}`)
console.log(`a27-37-club.html: threw=${a27Throws('fixtures/a27-37-club.html')}`)
assert(a27Throws('fixtures/a27-51-club.html'), 'a27-51-club.html: the real captured a=27 page throws when fed to parseClubDetail, confirming it shares none of a=26\'s markup')
assert(a27Throws('fixtures/a27-37-club.html'), 'a27-37-club.html: same, for the second sampled club')

// rqtid=1's own stats table: 290 of Voss's 1271 members have ever flown.
const vossStats = parseClubStats(readFileSync('fixtures/rqtid1-51.html', 'utf8'), 51)
console.log(`rqtid1-51.html: stats=${vossStats.length}`)
assert(vossStats.length === 290, `rqtid1-51.html: parses all 290 pilot-stats rows (got ${vossStats.length})`)

// A real, zero-member club (37) and a nonexistent club_id render the IDENTICAL empty stats
// table — confirmed byte-identical live (see docs/flightlog-api.md's "THE JOIN") — the parser
// itself cannot and does not try to tell them apart; both simply parse to [].
const eikenStats = parseClubStats(readFileSync('fixtures/rqtid1-37.html', 'utf8'), 37)
const nonexistentStats = parseClubStats(readFileSync('fixtures/rqtid1-nonexistent-club.html', 'utf8'), 999999999)
console.log(`rqtid1-37.html: stats=${eikenStats.length}, rqtid1-nonexistent-club.html: stats=${nonexistentStats.length}`)
assert(eikenStats.length === 0, `rqtid1-37.html: a real empty club parses to zero stats rows (got ${eikenStats.length})`)
assert(nonexistentStats.length === 0, `rqtid1-nonexistent-club.html: a nonexistent club ALSO parses to zero stats rows — the parser cannot tell these apart (got ${nonexistentStats.length})`)

// The danger #7 exists to make impossible: rqtid=1 WITHOUT club_id doesn't error or come back
// empty, it silently returns 146 rows belonging to a completely different club. This fixture
// pins that live measurement so it can't quietly drift unnoticed; getClubStats's own signature
// (a required, non-optional clubId, never an options bag) is what actually stops this from
// ever reaching production, not this assertion — see club-stats.ts's own doc comment.
const missingClubIdStats = parseClubStats(readFileSync('fixtures/rqtid1-missing-club-id.html', 'utf8'), 51)
console.log(`rqtid1-missing-club-id.html: stats=${missingClubIdStats.length} (a plausible-looking WRONG answer, not an error)`)
assert(
  missingClubIdStats.length === 146,
  `rqtid1-missing-club-id.html: omitting club_id returns 146 rows of an unrelated club, not an error (got ${missingClubIdStats.length}) — confirms the danger getClubStats's required-clubId signature guards against`,
)

// country_id is decorative for this endpoint — omitting it (with club_id present) returns a
// result identical to the full request, confirmed both by byte-for-byte fixture equality and
// by the parsed row count here.
const missingCountryIdStats = parseClubStats(readFileSync('fixtures/rqtid1-missing-country-id.html', 'utf8'), 51)
console.log(`rqtid1-missing-country-id.html: stats=${missingCountryIdStats.length}`)
assert(
  missingCountryIdStats.length === vossStats.length,
  `rqtid1-missing-country-id.html: omitting country_id (with club_id present) parses identically to the full request (got ${missingCountryIdStats.length} vs ${vossStats.length})`,
)

// THE JOIN (see resolve-stats-pilots.ts and docs/flightlog-api.md): Voss's roster carries two
// distinct user_ids both named "Cato Wiese-Hansen" against a single rqtid=1 stats row — this
// must resolve to userId: null, never a guess at which of the two flew.
const vossResolved = resolveStatsPilots(vossRoster, vossStats)
const catoRow = vossResolved.find((row) => row.name === 'Cato Wiese-Hansen')
const resolvedCount = vossResolved.filter((row) => row.userId !== null).length
console.log(`Voss join: resolved=${resolvedCount}/${vossResolved.length}, Cato Wiese-Hansen userId=${catoRow?.userId ?? 'null'}`)
assert(catoRow !== undefined, 'Voss join: the ambiguous "Cato Wiese-Hansen" stats row is present in the resolved output')
assert(catoRow?.userId === null, `Voss join: "Cato Wiese-Hansen" resolves to userId null, not a guessed id (got ${catoRow?.userId})`)
assert(resolvedCount > 0 && resolvedCount < vossResolved.length, `Voss join: some stats rows resolve unambiguously and at least one does not (got ${resolvedCount}/${vossResolved.length})`)

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

// #76: the join module cross-checked against pilot-4549's FULL real logbook (134 rows) and
// Norway's full curated takeoff dataset — the only case that can prove the real-world matched/
// unmatched split, which a small trimmed inline HTML snippet (join-flown-sites.test.ts's own
// synthetic cases) cannot reproduce. Exact counts pinned here are fixture-vs-fixture (both
// sides frozen at the same curation time — see the README's "Frozen pins vs. live pins"
// section), not a live-vs-frozen countdown, so this can stay an exact equality like
// check:parsers' other fixture-vs-fixture pins. Measured directly against these two fixtures,
// not copied from the issue's own scouted estimate (which undercounted this split — this
// pilot's logbook carries flights from Norway plus 3 other countries, France, Italy and Spain/
// Canary Islands, 8 distinct foreign ("uncurated-country") sites, plus one matched-by-id
// Norwegian takeoff ("...") whose own coordinates are flightlog.org's 0,0 placeholder
// ("no-known-location") — 9 unmatched in total, not the issue's scouted 5).
const pilot4549Flights = parseFlights(readFileSync('fixtures/pilot-4549.html', 'utf8'), 4549)
const flownSites = joinFlownSites(pilot4549Flights, takeoffs, CURATED_TAKEOFF_COUNTRY_IDS)
const unmatchedNames = flownSites.unmatched.map((u) => u.name).sort()
console.log(`pilot-4549.html x takeoffs-160.html: matched=${flownSites.sites.length} unmatched=${flownSites.unmatched.length}`)
assert(flownSites.sites.length === 22, `pilot-4549 x takeoffs-160: 22 distinct, plottable matched sites (got ${flownSites.sites.length})`)
assert(flownSites.unmatched.length === 9, `pilot-4549 x takeoffs-160: 9 distinct unmatched takeoffs (got ${flownSites.unmatched.length})`)
assert(
  flownSites.unmatched.filter((u) => u.reason === 'uncurated-country').length === 8,
  `pilot-4549 x takeoffs-160: 8 of the 9 unmatched are foreign/uncurated-country (got ${flownSites.unmatched.filter((u) => u.reason === 'uncurated-country').length})`,
)
assert(
  flownSites.unmatched.filter((u) => u.reason === 'no-known-location').length === 1,
  `pilot-4549 x takeoffs-160: exactly 1 of the 9 unmatched is a matched-but-uncoordinated Norwegian takeoff (got ${flownSites.unmatched.filter((u) => u.reason === 'no-known-location').length})`,
)
assert(
  flownSites.unmatched.every((u) => u.reason !== 'unlinked' && u.reason !== 'not-found'),
  `pilot-4549 x takeoffs-160: no flight in this fixture is link-less or references a curated-country id absent from the dataset (reasons: ${flownSites.unmatched.map((u) => u.reason).join(', ')})`,
)
assert(
  JSON.stringify(unmatchedNames) ===
    JSON.stringify([
      '...',
      'Brosso, Cima Cavallaria, Manifestazione',
      'Lanzarote, Famara Upper start',
      'Lanzarote, Famara,  lower start',
      'Lanzarote, Mala',
      'Lanzarote, Mirador del Rio',
      'Lanzarote, Tinasoria',
      'Lanzarote, el Cuchillo',
      'Laragne, Chabre',
    ]),
  `pilot-4549 x takeoffs-160: the exact 9 unmatched site names (got ${JSON.stringify(unmatchedNames)})`,
)
// hasKnownLocation, not a bare lat!==0 && lon!==0 check — the same oracle join-flown-sites.ts
// itself uses to classify 'no-known-location' (see classifyRef), so this actually pins the
// invariant the join promises ("no matched site carries a placeholder/corrupt coordinate"),
// not a narrower one. A bare zero-check would stay green for the OTHER corrupt shapes
// hasKnownLocation also guards against (one axis dropped to 0, or both corrupted near Null
// Island) reaching `sites` undetected.
assert(
  flownSites.sites.every(hasKnownLocation),
  'pilot-4549 x takeoffs-160: every matched site carries a real, known (non-placeholder, non-corrupt) location from the takeoffs dataset',
)

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
