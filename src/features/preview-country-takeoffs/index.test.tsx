import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TakeoffsPreview, { TakeoffCountView } from './index'

// Stubs the real network boundary (global fetch), not the hook — mocking the hook would let
// a default export that never calls it, and instead returns a hardcoded state, pass this
// suite unnoticed. This is exactly the mutation the review demonstrated: a consumer that
// ignores its countryId prop, never calls useTakeoffCount, never fetches, and returns a
// hardcoded 6012 previously survived the whole gate because nothing rendered this export.
function stubFetch(response: { ok: boolean; status: number; body: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TakeoffsPreview (default export)', () => {
  it('shows the loading state before hydration settles, not something already resolved', () => {
    stubFetch({ ok: true, status: 200, body: [] })

    render(<TakeoffsPreview countryId={999} />)

    screen.getByText(/loading takeoffs/i)
  })

  // A distinctive, non-6012 count from a country id that isn't 160 — this cannot pass by
  // coincidence with a hardcoded placeholder tuned to Norway's fixture size, and it proves
  // the prop actually reaches the network request.
  it('fetches the real per-country asset and renders the fetched count, not a hardcoded one', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: [
        [1, 'a', 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 'b', 20, 30, 40, 50, 60, 70, 80, 90],
        [11, 'c', 21, 31, 41, 51, 61, 71, 81, 91],
        [12, 'd', 22, 32, 42, 52, 62, 72, 82, 92],
      ],
    })

    render(<TakeoffsPreview countryId={999} />)

    await screen.findByText('4 takeoffs loaded')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/countries/999/takeoffs', expect.anything())
  })
})

describe('TakeoffCountView', () => {
  it('shows a loading message while the fetch is in flight', () => {
    render(<TakeoffCountView state={{ status: 'loading' }} />)

    screen.getByText(/loading takeoffs/i)
  })

  it('shows the server-provided error message verbatim on failure', () => {
    render(<TakeoffCountView state={{ status: 'error', message: 'takeoffs for country 160: server returned 502' }} />)

    screen.getByText('takeoffs for country 160: server returned 502')
  })

  // Two very different counts, neither a "round" number that could coincidentally match a
  // hardcoded placeholder — this is the surface a mutation that renders a fixed count
  // instead of state.count has to survive, and it can't survive both of these disagreeing.
  it('renders the fetched count from state, not a number baked into the component', () => {
    render(<TakeoffCountView state={{ status: 'success', count: 6012 }} />)
    screen.getByText('6012 takeoffs loaded')
  })

  it('renders a second, different fetched count correctly too', () => {
    render(<TakeoffCountView state={{ status: 'success', count: 3 }} />)
    screen.getByText('3 takeoffs loaded')
  })

  it('renders zero takeoffs as a real count, not the loading or error state', () => {
    render(<TakeoffCountView state={{ status: 'success', count: 0 }} />)
    screen.getByText('0 takeoffs loaded')
  })
})
