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

  it('shows an icon in the no-matches state', () => {
    const { container } = render(<SearchPilots query="zzznomatchxyz123" minLength={3} results={[]} isSignedIn={false} followedPilotIds={[]} />)

    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders one row per result, linking to the pilot profile and a follow button carrying the pilot id', () => {
    render(
      <SearchPilots
        query="Surname"
        minLength={3}
        results={[
          { userId: 900019, name: 'Pilot Nineteen', country: 'Norway' },
          { userId: 900016, name: 'Pilot Sixteen', country: 'Norway' },
        ]}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Pilot Nineteen' }).getAttribute('href')).toBe('/pilots/900019')
    expect(screen.getByRole('link', { name: 'Pilot Sixteen' }).getAttribute('href')).toBe('/pilots/900016')
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(2)
  })

  it('styles the results table with the form layer: rule borders and form-label headers', () => {
    const { container } = render(
      <SearchPilots
        query="Surname"
        minLength={3}
        results={[{ userId: 900019, name: 'Pilot Nineteen', country: 'Norway' }]}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(container.querySelector('thead tr')?.className).toContain('border-rule')
    const headers = [...container.querySelectorAll('thead th')]
    expect(headers.length).toBeGreaterThan(0)
    for (const th of headers) expect(th.className).toContain('form-label')
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(1)
    for (const tr of rows) expect(tr.className).toContain('border-rule')
  })

  it('marks a result row as already-followed when its pilot id is in followedPilotIds', () => {
    render(
      <SearchPilots
        query="Surname"
        minLength={3}
        results={[{ userId: 900019, name: 'Pilot Nineteen', country: 'Norway' }]}
        isSignedIn
        followedPilotIds={[900019]}
      />,
    )

    screen.getByRole('button', { name: 'Following' })
  })

  it('renders a sign-in prompt instead of follow buttons when signed out', () => {
    render(
      <SearchPilots
        query="Surname"
        minLength={3}
        results={[{ userId: 900019, name: 'Pilot Nineteen', country: 'Norway' }]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull()
    screen.getByRole('link', { name: /sign in to follow/i })
  })

  it('submits the search as a plain GET to /pilots/search with the query pre-filled', () => {
    render(<SearchPilots query="Surname" minLength={3} results={[]} isSignedIn={false} followedPilotIds={[]} />)

    const input = screen.getByRole('textbox', { name: /pilot name/i }) as HTMLInputElement
    expect(input.value).toBe('Surname')
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
