import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BackLink } from './back-link'

const mockBack = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}))

beforeEach(() => {
  mockBack.mockClear()
  mockPush.mockClear()
})

describe('BackLink', () => {
  // #234: a hardcoded href="/" sent every visitor to the "Recent flights" feed regardless of
  // which of the several rows that link here (pilot logbook, takeoff detail, flight feed,
  // account activity, longest flights) they actually came from. router.back() returns to that
  // real origin instead.
  it('goes back in history when there is in-app history to go back to', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2)
    render(<BackLink />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  // A direct load or bookmark has no in-app history to return to — history.back() would either
  // do nothing or leave the app entirely, so this falls back to the recent-flights feed instead.
  it('falls back to "/" when there is no history to go back to', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
    render(<BackLink />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(mockPush).toHaveBeenCalledWith('/')
    expect(mockBack).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
