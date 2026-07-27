import { existsSync, readFileSync } from 'node:fs'
import { parseFlights, parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTrack } from '../src/lib/flightlog/parse-track'
import { parseCountries } from '../src/lib/flightlog/parse-countries'
import { parseClubs } from '../src/lib/flightlog/parse-clubs'

const fixtures = [
  ['fixtures/pilot-12677.html', 12677],
  ['fixtures/pilot-4549.html', 4549],
] as const

const missing = [
  ...fixtures.map(([f]) => f),
  'fixtures/track-1001428.kml',
  'fixtures/countries.html',
  'fixtures/clubs-160.html',
  'fixtures/clubs-29.html',
].filter((f) => !existsSync(f))
if (missing.length > 0) {
  console.error(`Missing fixtures: ${missing.join(', ')}\nThey are gitignored because the scraped pages contain personal data. See README.`)
  process.exit(1)
}

for (const [file, userId] of fixtures) {
  const html = readFileSync(file, 'utf8')
  const flights = parseFlights(html, userId)
  console.log(`${file}: pilot=${parsePilot(html, userId).name} flights=${flights.length} missingTakeoff=${flights.filter((f) => !f.takeoff).length}`)
}

const track = parseTrack(readFileSync('fixtures/track-1001428.kml', 'utf8'), 1001428)
console.log(`track 1001428: points=${track.points.length} maxAlt=${track.stats.maxAltitude} duration=${track.stats.duration}`)

const countries = parseCountries(readFileSync('fixtures/countries.html', 'utf8'))
const norway = countries.find((country) => country.countryId === 160)
console.log(`countries.html: countries=${countries.length} norway=${norway?.name ?? 'MISSING'}`)

const clubs = parseClubs(readFileSync('fixtures/clubs-160.html', 'utf8'), 160)
console.log(`clubs-160.html: clubs=${clubs.length} sample=${clubs[0]?.name}`)

const emptyClubs = parseClubs(readFileSync('fixtures/clubs-29.html', 'utf8'), 29)
console.log(`clubs-29.html (Bouvet Island): clubs=${emptyClubs.length}`)
