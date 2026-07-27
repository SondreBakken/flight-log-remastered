import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TakeoffDirectory from './index'
import { MAX_RENDERED_RESULTS, type RegionOption } from './select-visible-takeoffs'

// Stubs the real network boundary (global fetch), not the hook — mocking the hook would let a
// default export that never calls it, and instead returns a hardcoded state, pass this suite
// unnoticed. Same reasoning #38's review already established for this component's ancestor.
function stubFetch(rows: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rows),
    }),
  )
}

// Builds a wire-shaped TakeoffRow tuple (see contract.ts's own field order) with realistic
// in-range lat/lon/wind, so isTakeoffRows accepts it — only takeoffId, name and regionId
// (indices 0, 1, 6) are ever varied by these tests.
function makeRow(takeoffId: number, name: string, regionId: number): unknown[] {
  return [takeoffId, name, 60, 10, 0, 999, regionId, 0, 500, 100]
}

const REGIONS: RegionOption[] = [
  { regionId: 1, name: 'Østlandet' },
  { regionId: 2, name: 'Vestlandet' },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TakeoffDirectory — input-driven filtering', () => {
  it('narrows the rendered rows as the user types, folding Norwegian characters along the way', async () => {
    stubFetch([makeRow(1, 'Bodø', 1), makeRow(2, 'Ålesund', 2), makeRow(3, 'Oslo', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('Bodø')
    screen.getByText('Ålesund')
    screen.getByText('Oslo')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'bodo' } })

    await waitFor(() => expect(screen.queryByText('Oslo')).toBeNull())
    screen.getByText('Bodø')
    expect(screen.queryByText('Ålesund')).toBeNull()
  })

  it("finds the issue's own worked example live, through the real rendered component", async () => {
    stubFetch([makeRow(1, 'Vågå', 1), makeRow(2, 'Unrelated', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Vågå')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'Vagaa' } })

    await waitFor(() => expect(screen.queryByText('Unrelated')).toBeNull())
    screen.getByText('Vågå')
  })

  it('filters by the selected region and displays the region NAME on each row, not its bare id', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 2)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')
    const list = screen.getByRole('list')
    within(list).getByText('Østlandet')
    within(list).getByText('Vestlandet')

    fireEvent.change(screen.getByRole('combobox', { name: /region/i }), { target: { value: '2' } })

    await waitFor(() => expect(within(list).queryByText('Alpha')).toBeNull())
    within(list).getByText('Beta')
    within(list).getByText('Vestlandet')
    expect(within(list).queryByText('Østlandet')).toBeNull()
  })

  it('caps the rendered rows and shows a visible truncation notice, which disappears once the match set narrows under the cap', async () => {
    const rows = Array.from({ length: MAX_RENDERED_RESULTS + 50 }, (_, i) => makeRow(i, `Site${i}`, 1))
    rows.push(makeRow(999_999, 'UniqueOnly', 2))
    stubFetch(rows)

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText(new RegExp(`Showing ${MAX_RENDERED_RESULTS} of ${MAX_RENDERED_RESULTS + 51} matches`))
    // The notice text alone isn't proof the DOM itself is capped — it's derived from the same
    // totalMatchCount either way. Counting actual rendered <li> rows is what catches a cap
    // that silently stopped applying to `matches` while `isTruncated`'s arithmetic (and so the
    // notice text) kept computing correctly regardless.
    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_RENDERED_RESULTS)

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'uniqueonly' } })

    await screen.findByText('UniqueOnly')
    expect(screen.queryByText(/showing \d+ of \d+ matches/i)).toBeNull()
  })

  it('shows the loading state before the fetch resolves', () => {
    stubFetch([])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    screen.getByText(/loading takeoffs/i)
  })

  it('shows the server-provided error message verbatim on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({ error: 'boom' }) }),
    )

    render(<TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('takeoffs for country 160: server returned 502')
  })

  it('shows a distinct empty state for a real zero-match search, not the loading or error state', async () => {
    stubFetch([makeRow(1, 'Bodø', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Bodø')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'zzznomatchxyz' } })

    await screen.findByText(/no takeoffs match/i)
  })

  it('renders the real fetched takeoff count in the header, not a hardcoded one', async () => {
    stubFetch([makeRow(1, 'Bodø', 1), makeRow(2, 'Ålesund', 2), makeRow(3, 'Oslo', 1), makeRow(4, 'Vågå', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('4 takeoffs')
  })
})
