import * as cheerio from 'cheerio'
import { HONEYPOT_SELECTOR } from './honeypot'
import type { CountryCounts } from './types'

const PILOTS_HEADING = 'No of registered users per country:'
const CLUBS_HEADING = 'No of clubs per country:'
const PILOTS_LINK_ACTION = 48
const CLUBS_LINK_ACTION = 25

// The page has two lists, each opened by its heading text. The heading is the boundary, so
// a pilots anchor can never land in the clubs map. Sections are cut from the raw HTML
// between the heading positions; cheerio tolerates the resulting fragments.
function sliceSection(html: string, heading: string, otherHeading: string): string {
  const start = html.indexOf(heading)
  if (start === -1) return ''
  const bodyStart = start + heading.length
  const other = html.indexOf(otherHeading)
  const end = other > start ? other : html.length
  return html.slice(bodyStart, end)
}

// First count wins on a duplicate id; an entry whose text after the anchor is not
// `(digits)` is skipped, never read as 0.
function readCounts(sectionHtml: string, action: number): Map<number, number> {
  const counts = new Map<number, number>()
  const $ = cheerio.load(sectionHtml)
  $('a[href*="country_id="]')
    .not(HONEYPOT_SELECTOR)
    .each((_, element) => {
      const href = $(element).attr('href') ?? ''
      if (!href.includes(`a=${action}`)) return
      const countryId = href.match(/country_id=(\d+)/)?.[1]
      const next = element.next
      const count = next?.type === 'text' ? next.data.match(/^\s*\((\d+)\)/)?.[1] : undefined
      if (countryId === undefined || count === undefined) return
      const id = Number(countryId)
      if (!counts.has(id)) counts.set(id, Number(count))
    })
  return counts
}

export function parseCountryCounts(html: string): CountryCounts {
  return {
    pilots: readCounts(sliceSection(html, PILOTS_HEADING, CLUBS_HEADING), PILOTS_LINK_ACTION),
    clubs: readCounts(sliceSection(html, CLUBS_HEADING, PILOTS_HEADING), CLUBS_LINK_ACTION),
  }
}
