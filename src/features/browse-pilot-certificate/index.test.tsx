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

  it('renders each level and the upcoming block as a named region with a full-strength heading', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP3" levelSetAt={null} />)
    screen.getByRole('region', { name: 'PP2' })
    screen.getByRole('region', { name: /progress toward pp4/i })
    for (const name of ['PP2', 'PP3', 'PP5', /progress toward pp4/i]) {
      expect(screen.getByRole('heading', { name }).className).not.toMatch(/opacity/)
    }
  })

  it.each([
    ['PP2', 'PP3', null, 'PP4'],
    ['PP3', 'PP4', 'PP3', 'PP5'],
    ['PP4', 'PP5', 'PP4', null],
  ] as const)('declared %s: places "%s: shown above" between its neighbouring level headings', (declared, upcoming, before, after) => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level={declared} levelSetAt={null} />)
    const placeholder = screen.getByText(`${upcoming}: shown above`)
    expect(placeholder.tagName).toBe('P')
    expect(placeholder.className).toMatch(/border-dashed/)
    expect(screen.queryByRole('heading', { name: upcoming })).toBeNull()
    const follows = Node.DOCUMENT_POSITION_FOLLOWING
    if (before) expect(screen.getByRole('heading', { name: before }).compareDocumentPosition(placeholder) & follows).toBeTruthy()
    if (after) expect(placeholder.compareDocumentPosition(screen.getByRole('heading', { name: after })) & follows).toBeTruthy()
  })

  it('renders no next-level checklist, only the full table, once the declared level is PP5', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP5" levelSetAt={null} />)
    expect(screen.queryByText(/progress toward/i)).toBeNull()
    screen.getByText(/view full requirements/i)
    screen.getByRole('heading', { name: 'PP4' })
    screen.getByRole('heading', { name: 'PP5' })
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'))).toEqual(
      ['PP2', 'PP3', 'PP4', 'PP5'].map((tableLevel) => `certificate-level-${tableLevel}-heading`),
    )
    expect(screen.queryByText(/shown above/)).toBeNull()
  })

  it('does not re-render the upcoming level a second time inside the full requirements table', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP3" levelSetAt={null} />)

    screen.getByText(/progress toward pp4/i)
    expect(screen.queryByRole('heading', { name: 'PP4' })).toBeNull()
    screen.getByRole('heading', { name: 'PP2' })
    screen.getByRole('heading', { name: 'PP3' })
    screen.getByRole('heading', { name: 'PP5' })
    screen.getByText('PP4: shown above')
  })

  it('renders the level form for the owner even once a level is declared, prefilled once opened', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level="PP3" levelSetAt={null} />)
    fireEvent.click(screen.getByRole('button', { name: /edit certificate level/i }))
    expect(screen.getByLabelText<HTMLSelectElement>(/current certificate level/i).value).toBe('PP3')
  })
})
