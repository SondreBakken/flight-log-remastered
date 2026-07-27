import { describe, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TakeoffCountView } from './index'

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
