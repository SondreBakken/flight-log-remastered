import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlyingDaysCalendar } from './flying-days-calendar'

// #81's actual byte-size claim, tested rather than asserted in prose: a collapsed year's day
// cells must never reach the streamed HTML in the first place — a <details> wrapper would not
// do this (children render regardless of `open`), which is why the gating lives in useState on
// a client component instead. Server-rendered here with renderToStaticMarkup, the same
// mechanism the payload leaving the server actually uses, rather than through RTL's client-only
// render (see follow-button/index.server.test.tsx for the same reasoning).
describe('FlyingDaysCalendar server render', () => {
  it('omits day-cell markup for collapsed years and keeps it for expanded years', () => {
    // 8 flight-bearing years: 5 within the default-expanded budget (2026 down to 2022), 3
    // beyond it (2021, 2020, 2019) that must collapse to a one-line button each.
    const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]
    const flightsByDate = new Map(years.map((year) => [`${year}-01-10`, 1]))

    const markup = renderToStaticMarkup(<FlyingDaysCalendar flightsByDate={flightsByDate} today="2026-08-03" />)
    const container = document.createElement('div')
    container.innerHTML = markup

    const expandedYears = [2026, 2025, 2024, 2023, 2022]
    const collapsedYears = [2021, 2020, 2019]

    for (const year of expandedYears) {
      expect(container.querySelector(`[aria-label^="${year}:"]`)).not.toBeNull()
    }
    for (const year of collapsedYears) {
      expect(container.querySelector(`[aria-label^="${year}:"]`)).toBeNull()
      expect(container.textContent).toContain(`${year}: 1 flying day, 1 flight`)
    }

    // The claim in numbers: 5 expanded years' worth of day-cell divs reach the markup, zero
    // day-cell divs exist for the 3 collapsed years — collapsing them removes their cells
    // entirely rather than just hiding them with CSS.
    const dayCellCount = container.querySelectorAll('.h-3.w-3').length
    expect(dayCellCount).toBeGreaterThan(0)
    for (const year of collapsedYears) {
      expect(container.querySelectorAll(`[title^="${year}-"]`).length).toBe(0)
    }
  })
})
