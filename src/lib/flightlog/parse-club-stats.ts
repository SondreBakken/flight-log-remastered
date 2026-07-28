import type { Nodes } from './parse-flightlog-table'
import { extractDataRows } from './parse-flightlog-table'
import type { ClubPilotStats } from './types'

// The exact header `rqtid=1` renders, unwrapped or not — see extractDataRows, which anchors
// on this header's field NAMES rather than the table's presence alone, the same positive
// signal rqtid=9/10/11 use for their own bare `<table border=1>` responses. This is what
// tells a genuine "real club, zero flights" response (header present, zero rows — Voss's own
// zero-member-club fixture, byte-identical to a nonexistent club_id's response, see
// docs/flightlog-api.md's "THE JOIN") apart from unrecognised markup.
const EXPECTED_HEADER = ['Name', 'Flights', 'Distance (km)', 'Time (hours)'] as const

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Flights is a plain integer cell, never a distance — same reasoning as parse-clubs.ts's own
// readInteger.
function readInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

// Distance/Time are fixed decimals (`0.0000`, `242.4000`) — every sampled value uses a plain
// `.`, never a `,` thousands separator (the largest observed, 391.5, is nowhere near where
// one would appear) — so this deliberately does NOT borrow parse-flights.ts's comma-as-
// decimal handling, same reasoning parse-clubs.ts gives for its own readInteger.
function readDecimal(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

function toStats(row: Nodes): ClubPilotStats | null {
  const cells = row.children('td')
  if (cells.length !== 4) return null

  const name = textOrNull(cells.eq(0).text())
  const flights = readInteger(cells.eq(1).text())
  const distanceKm = readDecimal(cells.eq(2).text())
  const hours = readDecimal(cells.eq(3).text())
  if (name === null || flights === null || distanceKm === null || hours === null) return null

  return { name, flights, distanceKm, hours }
}

// `clubId` is a required, non-optional parameter deliberately — never given a default and
// never accepted as part of an options bag a caller could omit a key from. Measured live:
// `rqtid=1` WITHOUT `club_id` does not error and does not come back empty, it silently
// returns 146 rows of a DIFFERENT, unrelated club's pilots (see docs/flightlog-api.md) — a
// plausible-looking, wrong answer a caller could easily ship without noticing. Putting
// `clubId` here, in the parser's own signature, rather than only in the fetcher that builds
// the URL (club.ts's getClubStats) means the mistake this guards against — someone building
// the query string by hand and forgetting the param — has nowhere left to happen: nothing
// calls the flightlog.org endpoint without going through a function that requires the id.
export function parseClubStats(html: string, clubId: number): ClubPilotStats[] {
  const rows = extractDataRows(html, EXPECTED_HEADER, `Club stats for club ${clubId}`)
  const stats = rows.map(toStats).filter((row): row is ClubPilotStats => row !== null)

  // Same floor check every parser in this file family uses: a row extractDataRows counted as
  // data but this file failed to extract is a defect, not a smaller stats table.
  if (stats.length !== rows.length) {
    throw new Error(`Club stats partially unparsed for club ${clubId}: ${stats.length}/${rows.length} rows recognised`)
  }

  return stats
}
