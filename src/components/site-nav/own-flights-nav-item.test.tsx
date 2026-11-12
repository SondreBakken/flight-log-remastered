import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { SignedInUserState } from '@/lib/auth/use-signed-in-user'
import AuthStatus from './auth-status'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'
import OwnFlightsNavItem from './own-flights-nav-item'

const mockUseSignedInUser = vi.fn<() => SignedInUserState>()
const mockFetchOwnPilotId = vi.fn()

vi.mock('@/lib/auth/use-signed-in-user', () => ({
  useSignedInUser: () => mockUseSignedInUser(),
}))

vi.mock('./fetch-own-pilot-id', () => ({
  fetchOwnPilotId: () => mockFetchOwnPilotId(),
}))

vi.mock('./fetch-own-verification', () => ({
  fetchOwnVerification: () => Promise.resolve('none'),
}))

const SIGNED_IN: SignedInUserState = { kind: 'signed-in', userId: 'user-1', email: 'pilot@example.com' }

beforeEach(() => {
  mockFetchOwnPilotId.mockResolvedValue(null)
})

function renderInList(ui: React.ReactElement) {
  return render(<ul>{ui}</ul>)
}

describe('OwnFlightsNavItem', () => {
  it('links to the pilot page with the shared nav classes and a 14px icon once a linked pilot id resolves (#243)', async () => {
    mockFetchOwnPilotId.mockResolvedValue(12677)
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    renderInList(<OwnFlightsNavItem />)

    const link = await screen.findByRole('link', { name: 'My flights' })
    expect(link.getAttribute('href')).toBe('/pilots/12677')
    expect(link.className).toBe(NAV_ICON_ROW_CLASSES)
    expect(screen.getByText('My flights').className).toBe(NAV_LABEL_CLASSES)
    const icon = link.querySelector('svg')
    expect(icon?.classList.contains('lucide-plane-takeoff')).toBe(true)
    expect(icon?.getAttribute('width')).toBe('14')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(link.closest('li')).toBeTruthy()
  })

  it('renders nothing while the session is loading', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'loading' })

    const { container } = renderInList(<OwnFlightsNavItem />)

    expect(container.querySelector('li')).toBeNull()
    expect(mockFetchOwnPilotId).not.toHaveBeenCalled()
  })

  it('renders nothing, and fetches nothing, when signed out', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })

    const { container } = renderInList(<OwnFlightsNavItem />)

    expect(container.querySelector('li')).toBeNull()
    expect(mockFetchOwnPilotId).not.toHaveBeenCalled()
  })

  it('renders nothing while the pilot id is still loading', () => {
    mockFetchOwnPilotId.mockReturnValue(new Promise(() => {}))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    const { container } = renderInList(<OwnFlightsNavItem />)

    expect(container.querySelector('li')).toBeNull()
  })

  it('renders no li when no pilot id is linked', async () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    const { container } = renderInList(<OwnFlightsNavItem />)

    await waitFor(() => expect(mockFetchOwnPilotId).toHaveBeenCalled())
    expect(container.querySelector('li')).toBeNull()
    expect(screen.queryByRole('link', { name: 'My flights' })).toBeNull()
  })

  it('surfaces a failed pilot id lookup in an li instead of silently hiding the link', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOwnPilotId.mockRejectedValue(new Error('/api/account/pilot-id answered 503'))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    renderInList(<OwnFlightsNavItem />)

    const warning = await screen.findByTitle('Could not load your pilot id')
    expect(warning.closest('li')).toBeTruthy()
    expect(warning.className).toContain('text-amber-700')
    expect(screen.queryByRole('link', { name: 'My flights' })).toBeNull()
    consoleError.mockRestore()
  })

  it('fetches the pilot id once per signed-in session, with the real AuthStatus rendered alongside', async () => {
    mockFetchOwnPilotId.mockResolvedValue(12677)
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    renderInList(
      <>
        <OwnFlightsNavItem />
        <AuthStatus />
      </>,
    )

    await screen.findByRole('link', { name: 'My flights' })
    expect(mockFetchOwnPilotId).toHaveBeenCalledTimes(1)
  })
})
