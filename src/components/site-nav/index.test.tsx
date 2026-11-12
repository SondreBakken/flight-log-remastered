import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SiteNav from './index'

// AuthStatus has its own colocated test (auth-status.test.tsx) covering its signed-in/signed-out
// states. Stubbing it out here keeps this test focused on what it already promises in its name
// — the nav links render regardless of other page state — without also having to stand up a
// signed-in user mock this test has no other use for. The testid stub marks its position so
// the dot-ordering test can assert against it.
vi.mock('./auth-status', () => ({ default: () => <span data-testid="auth-status-stub" /> }))

// The dot has its own colocated test; mocked so it adds no SVG and no fetch here.
vi.mock('./upstream-status-dot', () => ({ default: () => <span data-testid="upstream-status-dot-stub" /> }))

describe('SiteNav', () => {
  it('links to the flight feed, pilot search, country index, and followed list, regardless of any other page state', () => {
    render(<SiteNav />)

    // Search must be reachable from every page, not just a state that stops rendering once
    // the user follows anyone — see the doc comment on NAV_LINKS. Asserting all four links
    // exist unconditionally (SiteNav takes no props) is what that guarantee actually rests on.
    expect(screen.getByRole('link', { name: 'Flights' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Find a pilot' }).getAttribute('href')).toBe('/pilots/search')
    expect(screen.getByRole('link', { name: 'Countries' }).getAttribute('href')).toBe('/countries')
    expect(screen.getByRole('link', { name: 'Following' }).getAttribute('href')).toBe('/following')
  })

  it('gives each nav link a leading icon, plus the theme toggle icon', () => {
    const { container } = render(<SiteNav />)

    expect(container.querySelectorAll('svg').length).toBe(5)
  })

  it('renders the status dot between the theme toggle and the auth status', () => {
    render(<SiteNav />)

    const toggle = screen.getByRole('button', { name: /theme/i })
    const dot = screen.getByTestId('upstream-status-dot-stub')
    const authStatus = screen.getByTestId('auth-status-stub')
    expect(toggle.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dot.compareDocumentPosition(authStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses the Route icon for Flights, not Plane', () => {
    render(<SiteNav />)

    const icon = screen.getByRole('link', { name: 'Flights' }).querySelector('svg')
    expect(icon?.classList.contains('lucide-route')).toBe(true)
    expect(icon?.classList.contains('lucide-plane')).toBe(false)
  })

  it('keeps each label as sr-only text below sm: and visible from sm: up, never wrapping', () => {
    render(<SiteNav />)

    for (const name of ['Flights', 'Find a pilot', 'Countries', 'Following']) {
      const link = screen.getByRole('link', { name })
      expect(link.className).toContain('whitespace-nowrap')
      const label = screen.getByText(name)
      expect(label.className).toContain('sr-only')
      expect(label.className).toContain('sm:not-sr-only')
    }
  })
})
