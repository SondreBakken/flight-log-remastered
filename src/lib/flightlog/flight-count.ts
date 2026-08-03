import type { Flight } from './types'

// `flights.length` counts TABLE ROWS, not flights — a row aggregates same-day, same-glider
// flights (#68's `flightCount` field), so pilot 12677's four rows (flightCount 1, 2, 6, 1)
// are ten flights, not four (#70, confirmed against rqtid=1's own "Flights" column, which
// reports 10). Summing `flightCount` is what makes "N flights" true of the pilot's flying
// rather than of the table's row count.
//
// Shared by every view that reports a flight total (pilot logbook header, pilot statistics
// dashboard, #16) so the two cannot drift into reporting different numbers for the same
// pilot — previously a private helper duplicated in browse-pilot-logbook.
export function totalFlightCount(flights: Flight[]): number {
  return flights.reduce((total, flight) => total + flight.flightCount, 0)
}
