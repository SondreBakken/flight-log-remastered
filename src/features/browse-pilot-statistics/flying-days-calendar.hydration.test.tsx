import { describe, expect, it } from 'vitest'
import { renderThenHydrate } from '@/lib/testing/hydrate'
import { FlyingDaysCalendar } from './flying-days-calendar'

// #81's default-expanded/collapsed split is a pure function of props (defaultExpandedCalendarYears
// in statistics.ts), and `today` crosses the server/client boundary as a plain string rather than
// either side calling `new Date()` independently — see datesInYear's own comment for why that
// divergence is the exact class of defect src/lib/testing/hydrate.tsx exists to catch (#51).
// This pins that the closure holds: the same years are expanded pre- and post-hydration, with the
// DOM assertions below (not a console.error spy — React 19.2 routes a hydration mismatch through
// onRecoverableError/throw, not console.error, so a spy here would never fire either way) as the
// evidence.
describe('FlyingDaysCalendar hydration', () => {
  it('hydrates the default-expanded/collapsed split without a server/client mismatch', () => {
    const years = [2026, 2025, 2024, 2023, 2022, 2020]
    const flightsByDate = new Map(years.map((year) => [`${year}-01-10`, 1]))

    const tree = renderThenHydrate(<FlyingDaysCalendar flightsByDate={flightsByDate} today="2026-08-03" />)

    try {
      // 2020 is the 6th most recent flight-bearing year, outside the default-5 budget: collapsed
      // in the server markup, and still collapsed (not remounted expanded) after hydration.
      expect(tree.serverMarkup).not.toContain('aria-label="2020: 1 flying day, 1 flight"')
      expect(tree.container.querySelector('[aria-label^="2020:"]')).toBeNull()
      expect(tree.container.textContent).toContain('2020: 1 flying day, 1 flight')
    } finally {
      tree.unmount()
    }
  })
})
