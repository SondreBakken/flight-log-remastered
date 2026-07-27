import * as cheerio from 'cheerio'
import type { Club } from './types'

type Nodes = ReturnType<ReturnType<typeof cheerio.load>>

const CLUB_LINK_ACTION = 26
// Marks the results block on every clubs-in-a-country page, present (possibly empty) even
// when a country has no clubs — distinct from the page simply not being this kind of page.
const RESULTS_CONTAINER_SELECTOR = 'div[style*="padding:0px 10px"]'

function readNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function readClubId(href: string | undefined): number | null {
  const match = href?.match(/club_id=(\d+)/)
  return match ? Number(match[1]) : null
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// The flight-count cell has no matching open tag for its trailing </a> — real malformed
// markup on this page, same family of defect parse-flights.ts already works around.
function toClub(anchor: Nodes): Club | null {
  const clubId = readClubId(anchor.attr('href'))
  const name = textOrNull(anchor.text())
  const flightCount = readNumber(anchor.closest('tr').children('td').eq(1).text())
  if (clubId === null || name === null || flightCount === null) return null

  return { clubId, name, flightCount }
}

export function parseClubs(html: string, countryId: number): Club[] {
  const $ = cheerio.load(html)
  const resultsContainer = $(RESULTS_CONTAINER_SELECTOR).first()
  if (resultsContainer.length === 0) {
    throw new Error(`Club list markup not recognised for country ${countryId}`)
  }

  return resultsContainer
    .find(`a[href*="a=${CLUB_LINK_ACTION}"]`)
    .toArray()
    .map((anchor) => toClub($(anchor)))
    .filter((club): club is Club => club !== null)
}
