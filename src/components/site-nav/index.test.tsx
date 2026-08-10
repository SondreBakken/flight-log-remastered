import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SiteNav from './index'

// AuthStatus has its own colocated test (auth-status.test.tsx) covering its signed-in/signed-out
// states. Stubbing it out here keeps this test focused on what it already promises in its name
// — the nav links render regardless of other page state — without also having to stand up a
// Supabase client mock this test has no other use for.
vi.mock('./auth-status', () => ({ default: () => null }))

describe('SiteNav', () => {
  it('links to the flight feed, pilot search, and country index, regardless of any other page state', () => {
    render(<SiteNav />)

    // Search must be reachable from every page, not just a state that stops rendering once
    // the user follows anyone — see the doc comment on NAV_LINKS. Asserting all three links
    // exist unconditionally (SiteNav takes no props) is what that guarantee actually rests on.
    expect(screen.getByRole('link', { name: 'Flights' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Find a pilot' }).getAttribute('href')).toBe('/pilots/search')
    expect(screen.getByRole('link', { name: 'Countries' }).getAttribute('href')).toBe('/countries')
  })
})
