import { existsSync, readFileSync } from 'node:fs'
import { parseFlights, parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTrack } from '../src/lib/flightlog/parse-track'

const fixtures = [
  ['fixtures/pilot-12677.html', 12677],
  ['fixtures/pilot-4549.html', 4549],
] as const

const missing = [...fixtures.map(([f]) => f), 'fixtures/track-1001428.kml'].filter((f) => !existsSync(f))
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
