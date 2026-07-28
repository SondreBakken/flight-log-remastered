import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CountryClubs from './index'

describe('CountryClubs', () => {
  it('renders a table row per club when clubs exist', () => {
    render(
      <CountryClubs
        countryId={160}
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 }]}
      />,
    )

    // getByRole/getByText throw if not found, so their return alone is the assertion.
    screen.getByRole('table')
    screen.getByText('Jetta Luftsportsklubb')
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
          { clubId: 77, name: 'Bergen Paragliderklubb', flightCount: 15 },
          { clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 },
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

  // #9's takeoff directory previously had no in-app link to it at all — reachable only by
  // typing the URL. This is its one entry point.
  it('links to the takeoff directory for a curated country', () => {
    render(<CountryClubs countryId={160} countryName="Norway" clubs={[]} />)

    expect(screen.getByRole('link', { name: /browse takeoffs/i }).getAttribute('href')).toBe(
      '/countries/160/takeoffs',
    )
  })

  // The takeoffs route itself 404s for any country outside the curated set (see
  // curated-countries.ts) — linking to it here for one would just be a link to a 404.
  it('does not link to the takeoff directory for a country outside the curated set', () => {
    render(<CountryClubs countryId={203} countryName="Sweden" clubs={[]} />)

    expect(screen.queryByRole('link', { name: /browse takeoffs/i })).toBeNull()
  })
})
