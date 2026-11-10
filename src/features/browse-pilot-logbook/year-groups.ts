import { totalDistanceKm, totalDurationMinutes } from '@/lib/flightlog/flight-aggregates'
import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { flightYear } from '@/lib/flightlog/flight-year'
import type { Flight } from '@/lib/flightlog/types'

export type LogbookTotals = {
  flightCount: number
  minutes: number
  distanceKm: number
}

export type YearGroup = {
  year: number
  flights: Flight[]
  thisYear: LogbookTotals
  // Everything flown in strictly earlier years.
  broughtForward: LogbookTotals
  // broughtForward plus thisYear.
  cumulative: LogbookTotals
}

const NOTHING_FLOWN: LogbookTotals = { flightCount: 0, minutes: 0, distanceKm: 0 }

function totalsOf(flights: Flight[]): LogbookTotals {
  return {
    flightCount: totalFlightCount(flights),
    minutes: totalDurationMinutes(flights),
    distanceKm: totalDistanceKm(flights),
  }
}

function addTotals(a: LogbookTotals, b: LogbookTotals): LogbookTotals {
  return {
    flightCount: a.flightCount + b.flightCount,
    minutes: a.minutes + b.minutes,
    distanceKm: a.distanceKm + b.distanceKm,
  }
}

// Newest year first. Placeholder-dated rows ('2026-00-00') group under their year, like
// statistics.ts's minutesByYear. Footer totals accumulate over an ascending pass, so a gap
// year simply carries the earlier total forward.
export function groupFlightsByYear(flights: Flight[]): YearGroup[] {
  const flightsByYear = new Map<number, Flight[]>()
  for (const flight of flights) {
    const year = flightYear(flight)
    flightsByYear.set(year, [...(flightsByYear.get(year) ?? []), flight])
  }

  const groups: YearGroup[] = []
  let broughtForward = NOTHING_FLOWN
  for (const year of [...flightsByYear.keys()].sort((a, b) => a - b)) {
    const yearFlights = flightsByYear.get(year) ?? []
    const thisYear = totalsOf(yearFlights)
    const cumulative = addTotals(broughtForward, thisYear)
    groups.push({ year, flights: yearFlights, thisYear, broughtForward, cumulative })
    broughtForward = cumulative
  }
  return groups.reverse()
}
