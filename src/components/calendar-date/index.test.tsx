import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { renderThenHydrate } from '@/lib/testing/hydrate'
import { CalendarDate } from '.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CalendarDate', () => {
  it('formats the date day-first in en-GB', () => {
    const { container } = render(<CalendarDate value="2026-09-05" />)
    expect(container.textContent).toBe('5 Sept 2026')
  })

  it('renders the identical string in server markup and after hydration, whatever the browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const tree = renderThenHydrate(<CalendarDate value="2026-09-05" />)
    try {
      expect(tree.serverMarkup).toBe('5 Sept 2026')
      expect(tree.container.textContent).toBe('5 Sept 2026')
    } finally {
      tree.unmount()
    }
  })
})
