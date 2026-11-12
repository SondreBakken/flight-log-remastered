import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CountryTabs } from './index'

describe('CountryTabs', () => {
  it.each([
    { active: 'clubs', inactive: 'Takeoffs', current: 'Clubs' },
    { active: 'takeoffs', inactive: 'Clubs', current: 'Takeoffs' },
  ] as const)('marks only the $current link current when active is $active', ({ active, inactive, current }) => {
    render(<CountryTabs countryId={160} active={active} />)

    const nav = screen.getByRole('navigation', { name: 'Country sections' })
    expect(nav.querySelectorAll('a')).toHaveLength(2)
    expect(screen.getByRole('link', { name: current }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: inactive }).hasAttribute('aria-current')).toBe(false)
  })

  it('links Clubs and Takeoffs to the country pages', () => {
    render(<CountryTabs countryId={160} active="clubs" />)

    expect(screen.getByRole('link', { name: 'Clubs' }).getAttribute('href')).toBe('/countries/160')
    expect(screen.getByRole('link', { name: 'Takeoffs' }).getAttribute('href')).toBe('/countries/160/takeoffs')
  })

  it('styles the active tab with theme tokens and the inactive one muted', () => {
    render(<CountryTabs countryId={160} active="clubs" />)

    expect(screen.getByRole('link', { name: 'Clubs' }).className).toContain('border-form')
    expect(screen.getByRole('link', { name: 'Takeoffs' }).className).toContain('text-muted')
  })

  it('renders nothing for a country outside the curated set', () => {
    const { container } = render(<CountryTabs countryId={203} active="clubs" />)

    expect(container.innerHTML).toBe('')
  })
})
