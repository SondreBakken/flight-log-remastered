import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { renderThenHydrate } from '@/lib/testing/hydrate'
import { CalendarDate } from '.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CalendarDate', () => {
  it("formats the date in the viewer's locale", () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
    const { container } = render(<CalendarDate value="2026-09-05" />)
    expect(container.textContent).toBe('5 Sept 2026')
  })

  it('renders the raw ISO date on the server and the locale date once hydrated', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const tree = renderThenHydrate(<CalendarDate value="2026-09-05" />)
    try {
      expect(tree.serverMarkup).toBe('2026-09-05')
      expect(tree.container.textContent).toBe('Sep 5, 2026')
    } finally {
      tree.unmount()
    }
  })
})
