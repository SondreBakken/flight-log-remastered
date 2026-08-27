import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import PilotCertificateProgress from './index'

const NO_FLIGHTS: Flight[] = []

describe('PilotCertificateProgress', () => {
  it('renders nothing for a non-owner when no level is declared', () => {
    const { container } = render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level={null} levelSetAt={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the level form, and no checklist, for the owner when no level is declared', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level={null} levelSetAt={null} />)
    screen.getByLabelText(/current certificate level/i)
    expect(screen.queryByText(/progress toward/i)).toBeNull()
  })

  it('renders a "progress toward PP4" checklist when the declared level is PP3', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP3" levelSetAt={null} />)
    screen.getByText(/progress toward pp4/i)
  })

  it('renders no next-level checklist, only the full table, once the declared level is PP5', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP5" levelSetAt={null} />)
    expect(screen.queryByText(/progress toward/i)).toBeNull()
    screen.getByText(/view full requirements/i)
  })

  it('renders the level form for the owner even once a level is declared, prefilled', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level="PP3" levelSetAt={null} />)
    expect(screen.getByLabelText<HTMLSelectElement>(/current certificate level/i).value).toBe('PP3')
  })
})
