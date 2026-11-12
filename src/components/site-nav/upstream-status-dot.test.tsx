import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UpstreamState } from '@/lib/flightlog/upstream-status'
import UpstreamStatusDot from './upstream-status-dot'

function answerWith(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const COLORS: ReadonlyArray<[UpstreamState, string, string]> = [
  ['up', 'bg-green-500', 'flightlog.org is up'],
  ['slow', 'bg-amber-500', 'flightlog.org is slow'],
  ['down', 'bg-red-500', 'flightlog.org is down'],
  ['unknown', 'bg-gray-400', 'flightlog.org status unknown'],
]

describe('UpstreamStatusDot', () => {
  it.each(COLORS)('shows %s as %s with the state in words', async (state, colorClass, words) => {
    answerWith({ state, lastCheckedAt: null })
    render(<UpstreamStatusDot />)

    await waitFor(() => expect(screen.getByTestId('upstream-status-dot').className).toContain(colorClass))
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(words)
  })

  it('shows the state and last checked text on hover, and hides it on leave', async () => {
    answerWith({ state: 'up', lastCheckedAt: Date.now() - 5 * 60_000 })
    render(<UpstreamStatusDot />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.mouseEnter(button)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('flightlog.org is up, last checked 5 min ago'))
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens on focus and toggles on tap', () => {
    answerWith({ state: 'unknown', lastCheckedAt: null })
    render(<UpstreamStatusDot />)
    const button = screen.getByRole('button')

    fireEvent.focus(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.blur(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('says no recent requests for an unknown state with a null lastCheckedAt', async () => {
    answerWith({ state: 'unknown', lastCheckedAt: null })
    render(<UpstreamStatusDot />)
    fireEvent.focus(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('no recent requests'))
  })

  it('renders unknown when the fetch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answerWith({ error: 'x' }, 500)
    render(<UpstreamStatusDot />)

    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(screen.getByTestId('upstream-status-dot').className).toContain('bg-gray-400')
  })

  it('refetches on hover', async () => {
    answerWith({ state: 'up', lastCheckedAt: null })
    render(<UpstreamStatusDot />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    fireEvent.mouseEnter(screen.getByRole('button'))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })
})
