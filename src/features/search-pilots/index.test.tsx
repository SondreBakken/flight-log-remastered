import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import SearchPilots from './index'

describe('SearchPilots', () => {
  it('shows no status message when no query has been submitted yet', () => {
    render(<SearchPilots query="" minLength={3} results={null} />)

    expect(screen.queryByText(/type at least/i)).toBeNull()
    expect(screen.queryByText(/no pilots match/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('prompts for more characters when the query is below minLength (results still null)', () => {
    render(<SearchPilots query="ab" minLength={3} results={null} />)

    screen.getByText(/type at least 3 characters/i)
  })

  it('renders a distinct "no matches" state for a real zero-match search, not the too-short prompt', () => {
    render(<SearchPilots query="zzznomatchxyz123" minLength={3} results={[]} />)

    screen.getByText(/no pilots match/i)
    expect(screen.queryByText(/type at least/i)).toBeNull()
  })

  it('renders one row per result, linking to the pilot profile and a follow button carrying the pilot id', () => {
    render(
      <SearchPilots
        query="Henden"
        minLength={3}
        results={[
          { userId: 754, name: 'Nils Aage Henden', country: 'Norway' },
          { userId: 2831, name: 'Børge Henden', country: 'Norway' },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Nils Aage Henden' }).getAttribute('href')).toBe('/pilots/754')
    expect(screen.getByRole('link', { name: 'Børge Henden' }).getAttribute('href')).toBe('/pilots/2831')
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(2)
  })

  it('submits the search as a plain GET to /pilots/search with the query pre-filled', () => {
    render(<SearchPilots query="Henden" minLength={3} results={[]} />)

    const input = screen.getByRole('textbox', { name: /pilot name/i }) as HTMLInputElement
    expect(input.value).toBe('Henden')
    // getByRole throws if not found, so its return alone is the assertion.
    screen.getByRole('button', { name: 'Search' })
  })
})
