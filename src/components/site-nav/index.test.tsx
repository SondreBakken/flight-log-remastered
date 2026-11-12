import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { SignedInUserState } from '@/lib/auth/use-signed-in-user'
import SiteNav from './index'

// AuthStatus has its own colocated test (auth-status.test.tsx) covering its signed-in/signed-out
// states, so it is stubbed here. The testid stub marks its position so the dot-ordering test can
// assert against it.
vi.mock('./auth-status', () => ({ default: () => <span data-testid="auth-status-stub" /> }))

// The dot has its own colocated test; mocked so it adds no SVG and no fetch here.
vi.mock('./upstream-status-dot', () => ({ default: () => <span data-testid="upstream-status-dot-stub" /> }))

// OwnFlightsNavItem is not stubbed: the session and pilot-id fetch are mocked so each case decides
// what it renders.
const mockUseSignedInUser = vi.fn<() => SignedInUserState>()
const mockFetchOwnPilotId = vi.fn()

vi.mock('@/lib/auth/use-signed-in-user', () => ({
  useSignedInUser: () => mockUseSignedInUser(),
}))

vi.mock('./fetch-own-pilot-id', () => ({
  fetchOwnPilotId: () => mockFetchOwnPilotId(),
}))

const SIGNED_IN: SignedInUserState = { kind: 'signed-in', userId: 'user-1', email: 'pilot@example.com' }

beforeEach(() => {
  mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })
  mockFetchOwnPilotId.mockResolvedValue(null)
})

function navLinkNames() {
  return screen.getAllByRole('link').map((link) => link.textContent)
}

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

  it('orders the links Flights, Find a pilot, Countries, Following when signed out, with no empty li', () => {
    const { container } = render(<SiteNav />)

    expect(navLinkNames()).toEqual(['Flights', 'Find a pilot', 'Countries', 'Following'])
    for (const li of container.querySelectorAll('nav ul li')) {
      expect(li.querySelector('a')).toBeTruthy()
    }
  })

  it('slots My flights right after Flights when signed in with a linked pilot', async () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    mockFetchOwnPilotId.mockResolvedValue(12677)
    const { container } = render(<SiteNav />)

    await screen.findByRole('link', { name: 'My flights' })
    expect(navLinkNames()).toEqual(['Flights', 'My flights', 'Find a pilot', 'Countries', 'Following'])
    expect(screen.getByRole('link', { name: 'My flights' }).getAttribute('href')).toBe('/pilots/12677')
    expect(container.querySelectorAll('svg').length).toBe(6)
    expect(screen.getByText('My flights').className).toContain('sm:not-sr-only')
  })

  it('shows no My flights li when signed in without a linked pilot', async () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    const { container } = render(<SiteNav />)

    await waitFor(() => expect(mockFetchOwnPilotId).toHaveBeenCalled())
    expect(navLinkNames()).toEqual(['Flights', 'Find a pilot', 'Countries', 'Following'])
    for (const li of container.querySelectorAll('nav ul li')) {
      expect(li.querySelector('a')).toBeTruthy()
    }
  })

  it('puts the failed-lookup warning li right after Flights, without a My flights link', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    mockFetchOwnPilotId.mockRejectedValue(new Error('503'))
    const { container } = render(<SiteNav />)

    const warning = await screen.findByTitle('Could not load your pilot id')
    const items = [...container.querySelectorAll('nav ul > li')]
    expect(items[1]).toBe(warning.closest('li'))
    expect(items[0].textContent).toBe('Flights')
    expect(screen.queryByRole('link', { name: 'My flights' })).toBeNull()
    consoleError.mockRestore()
  })
})
