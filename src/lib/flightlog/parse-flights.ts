import * as cheerio from 'cheerio'
import type { Flight, Pilot } from './types'

type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

const FLIGHT_ROW_CELL_COUNT = 7
const COUNTRY_LINK_ACTION = 47
const TAKEOFF_LINK_ACTION = 42

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readTripId(href: string | undefined): number | null {
  const match = href?.match(/trip_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function readDate(cellText: string): string | null {
  return cellText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
}

// A row can aggregate several flights from the same day, rendered as "00:10 / 2".
function readDuration(cellText: string): string | null {
  return cellText.match(/\d{1,2}:\d{2}/)?.[0] ?? null
}

function readFlightCount(cellText: string): number {
  return readNumber(cellText.match(/\/\s*(\d+)/)?.[1] ?? '') ?? 1
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// The date cell packs date, country link and takeoff link together; the links are told
// apart by which action code they point at.
function readLinkByAction(cell: Nodes, action: number): string | null {
  const link = cell.find(`a[href*="a=${action}"]`).first()
  return link.length === 0 ? null : textOrNull(link.text())
}

export function parsePilot(html: string, userId: number): Pilot {
  const $ = cheerio.load(html)
  const profileCell = $('td[width="s180"]').first()
  const lines = profileCell
    .html()
    ?.split(/<br\s*\/?>/i)
    .map((line) => cheerio.load(line).text().trim())
    .filter(Boolean)

  return {
    userId,
    name: lines?.[0] ?? `Pilot ${userId}`,
    country: lines?.[1] ?? null,
    club: textOrNull(profileCell.find('a[href*="a=26"]').first().text()),
  }
}

export function parseFlights(html: string, userId: number): Flight[] {
  const $ = cheerio.load(html)

  return $('tr')
    .toArray()
    .map((row) => toFlight($(row).children('td'), userId))
    .filter((flight): flight is Flight => flight !== null)
}

function toFlight(cells: Nodes, userId: number): Flight | null {
  if (cells.length !== FLIGHT_ROW_CELL_COUNT) return null

  const tripId = readTripId(cells.eq(0).find('a').first().attr('href'))
  const dateCell = cells.eq(1)
  const date = readDate(dateCell.text())
  if (tripId === null || date === null) return null

  return {
    tripId,
    userId,
    date,
    country: readLinkByAction(dateCell, COUNTRY_LINK_ACTION),
    takeoff: readLinkByAction(dateCell, TAKEOFF_LINK_ACTION),
    glider: textOrNull(cells.eq(2).text()),
    duration: readDuration(cells.eq(3).text()),
    flightCount: readFlightCount(cells.eq(3).text()),
    distanceKm: readNumber(cells.eq(4).text().trim()),
    openDistanceKm: readNumber(cells.eq(5).text().trim()),
    note: textOrNull(cells.eq(6).text()),
  }
}
