import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import SearchPilots from './index'

describe('SearchPilots', () => {
  it('shows no status message when no query has been submitted yet', () => {
    render(<SearchPilots query="" minLength={3} results={null} isSignedIn={false} followedPilotIds={[]} />)

    expect(screen.queryByText(/type at least/i)).toBeNull()
    expect(screen.queryByText(/no pilots match/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  // #241: an exact textContent match, not just a regex substring — a regex still passes even if
  // the space between {minLength} and "letters" goes missing at the source's own JSX compiler
  // level (this bug shipped past this exact regex once already, under a different bundler than
  // the one the live app actually runs; the fix removed the ambiguity at the source, this pins
  // the literal string the fix produces).
  it('prompts for more characters when the query is below minLength (results still null)', () => {
    render(<SearchPilots query="ab" minLength={3} results={null} isSignedIn={false} followedPilotIds={[]} />)

    expect(screen.getByText(/type at least/i).textContent).toBe(
      'Type at least 3 letters in a row to search (% and _ wildcards don’t count).',
    )
  })

  it('renders a distinct "no matches" state for a real zero-match search, not the too-short prompt', () => {
    render(<SearchPilots query="zzznomatchxyz123" minLength={3} results={[]} isSignedIn={false} followedPilotIds={[]} />)

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
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Nils Aage Henden' }).getAttribute('href')).toBe('/pilots/754')
    expect(screen.getByRole('link', { name: 'Børge Henden' }).getAttribute('href')).toBe('/pilots/2831')
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(2)
  })

  it('marks a result row as already-followed when its pilot id is in followedPilotIds', () => {
    render(
      <SearchPilots
        query="Henden"
        minLength={3}
        results={[{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }]}
        isSignedIn
        followedPilotIds={[754]}
      />,
    )

    screen.getByRole('button', { name: 'Following' })
  })

  it('renders a sign-in prompt instead of follow buttons when signed out', () => {
    render(
      <SearchPilots
        query="Henden"
        minLength={3}
        results={[{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull()
    screen.getByRole('link', { name: /sign in to follow/i })
  })

  it('submits the search as a plain GET to /pilots/search with the query pre-filled', () => {
    render(<SearchPilots query="Henden" minLength={3} results={[]} isSignedIn={false} followedPilotIds={[]} />)

    const input = screen.getByRole('textbox', { name: /pilot name/i }) as HTMLInputElement
    expect(input.value).toBe('Henden')
    // getByRole throws if not found, so its return alone is the assertion.
    screen.getByRole('button', { name: 'Search' })

    // A plain GET to a real Next.js route, not a client-side handler — the only thing standing
    // between a submitted query and the network is the server-side guard in pilot-search.ts, so
    // it matters that this really is a full-page navigation and not, say, a POST that would
    // silently change what gets guarded and when.
    const form = screen.getByRole('search') as HTMLFormElement
    expect(form.getAttribute('action')).toBe('/pilots/search')
    expect(form.method).toBe('get')
  })
})
