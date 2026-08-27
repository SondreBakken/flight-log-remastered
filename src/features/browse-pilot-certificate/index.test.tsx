import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import PilotCertificateProgress from './index'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const NO_FLIGHTS: Flight[] = []

describe('PilotCertificateProgress', () => {
  it('renders nothing for a non-owner when no level is declared', () => {
    const { container } = render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level={null} levelSetAt={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the level form, and no checklist, for the owner when no level is declared', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level={null} levelSetAt={null} />)
    screen.getByRole('button', { name: /edit certificate level/i })
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
    screen.getByRole('heading', { name: 'PP4' })
    screen.getByRole('heading', { name: 'PP5' })
  })

  it('does not re-render the upcoming level a second time inside the full requirements table', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP3" levelSetAt={null} />)

    screen.getByText(/progress toward pp4/i)
    expect(screen.queryByRole('heading', { name: 'PP4' })).toBeNull()
    screen.getByRole('heading', { name: 'PP2' })
    screen.getByRole('heading', { name: 'PP3' })
    screen.getByRole('heading', { name: 'PP5' })
  })

  it('renders the level form for the owner even once a level is declared, prefilled once opened', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level="PP3" levelSetAt={null} />)
    fireEvent.click(screen.getByRole('button', { name: /edit certificate level/i }))
    expect(screen.getByLabelText<HTMLSelectElement>(/current certificate level/i).value).toBe('PP3')
  })
})
