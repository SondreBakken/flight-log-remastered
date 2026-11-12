import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CountryClubs from './index'

describe('CountryClubs', () => {
  it('renders a table row per club when clubs exist', () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }]}
      />,
    )

    // getByRole/getByText throw if not found, so their return alone is the assertion.
    screen.getByRole('table')
    screen.getByText('Jetta Luftsportsklubb')
  })

  // #66: this column holds `Club.memberCount` (a=25's own value, confirmed against a=26's
  // explicit Members field — see parse-clubs.ts and check-parsers.mts), not a flight count —
  // the header must say so, not the "Flights" label this app rendered before the defect was
  // caught.
  it('labels the count column "Members", not "Flights"', () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }]}
      />,
    )

    screen.getByRole('columnheader', { name: 'Members' })
    expect(screen.queryByRole('columnheader', { name: 'Flights' })).toBeNull()
  })

  it('styles the table with the form layer: form-label headers and a tabular Members cell', () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }]}
      />,
    )

    for (const th of screen.getAllByRole('columnheader')) expect(th.className).toContain('form-label')
    expect(screen.getByText('18').className).toContain('tabular-nums')
    // Literal on purpose: the prerender check matches built output on this exact class.
    expect(screen.getByText('18').closest('tr')?.className).toBe('border-b border-rule')
  })

  it('links back to /countries, the actual index route, not a typo of it', () => {
    render(<CountryClubs countryId={160} countryName="Norway" clubs={[]} />)

    expect(screen.getByRole('link', { name: /back to countries/i }).getAttribute('href')).toBe(
      '/countries',
    )
  })

  // #7: clubs used to render as plain text with no way to reach a club's own page. Two
  // clubs, listed with the higher clubId first, so a bug that links by row INDEX (or by the
  // first/last club's id) rather than each row's own `club.clubId` shows up as a wrong href,
  // not an accidentally-correct one — the exact class of bug #11's review caught in a
  // sibling table before this test existed.
  it("links each club's name to its own club page, keyed by clubId, not row position", () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[
          { clubId: 77, name: 'Bergen Paragliderklubb', memberCount: 15 },
          { clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Bergen Paragliderklubb' }).getAttribute('href')).toBe(
      '/countries/160/clubs/77',
    )
    expect(screen.getByRole('link', { name: 'Jetta Luftsportsklubb' }).getAttribute('href')).toBe(
      '/countries/160/clubs/32',
    )
  })

  it('renders the deliberate empty state, not a table, when the country has no clubs', () => {
    render(<CountryClubs countryId={160} countryName="Bouvet Island" clubs={[]} />)

    expect(screen.queryByRole('table')).toBeNull()
    screen.getByText(/no clubs recorded/i)
  })

  // #9's takeoff directory previously had no in-app link to it at all, reachable only by
  // typing the URL. The Clubs/Takeoffs tab bar is its entry point.
  it('shows the Clubs/Takeoffs tabs between the header and the table for a curated country', () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Clubs' }).getAttribute('aria-current')).toBe('page')
    const takeoffs = screen.getByRole('link', { name: 'Takeoffs' })
    expect(takeoffs.getAttribute('href')).toBe('/countries/160/takeoffs')
    const nav = screen.getByRole('navigation', { name: 'Country sections' })
    const header = nav.parentElement!.querySelector('header')!
    expect(header.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nav.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('still shows the tabs when the country has no clubs', () => {
    render(<CountryClubs countryId={160} countryName="Norway" clubs={[]} />)

    screen.getByRole('navigation', { name: 'Country sections' })
  })

  it('has no Browse takeoffs footer link', () => {
    render(<CountryClubs countryId={160} countryName="Norway" clubs={[]} />)

    expect(screen.queryByRole('link', { name: /browse takeoffs/i })).toBeNull()
  })

  // The takeoffs route 404s outside the curated set, so no tab bar and no Takeoffs link there.
  it('shows no tabs for a country outside the curated set', () => {
    render(<CountryClubs countryId={203} countryName="Sweden" clubs={[]} />)

    expect(screen.queryByRole('link', { name: 'Takeoffs' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Country sections' })).toBeNull()
  })

  it('shows a leading icon on the back-to-countries link', () => {
    const { container } = render(<CountryClubs countryId={160} countryName="Norway" clubs={[]} />)

    expect(container.querySelector('svg')).toBeTruthy()
  })
})
