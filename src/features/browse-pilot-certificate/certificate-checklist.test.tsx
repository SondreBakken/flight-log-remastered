import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { EvaluatedRequirement } from '@/lib/certificates/types'
import { CertificateChecklist } from './certificate-checklist'

const mockToggleAction = vi.fn()
vi.mock('./actions', () => ({ toggleCertificateChecklistItemAction: (...args: unknown[]) => mockToggleAction(...args) }))

const ITEMS: EvaluatedRequirement[] = [
  { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', current: 12, threshold: 40, satisfied: false },
  {
    kind: 'experience',
    id: 'flights-over-1h',
    label: 'Single flights over 1 hour',
    unit: 'flights',
    current: 1,
    threshold: 3,
    satisfied: false,
    caveat: 'Only counts rows flightlog.org recorded as a single flight.',
  },
  { kind: 'tenure', id: 'held-pp3-12-months', label: 'Held PP3 for at least 12 months', daysHeld: 400, minDays: 365, satisfied: true },
  { kind: 'manual', id: 'safety-course', label: 'Completed the sikkerhetskurs', checked: false },
]

beforeEach(() => {
  mockToggleAction.mockReset()
})

describe('CertificateChecklist', () => {
  it('shows an experience item as current / threshold', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    screen.getByText('12.0 / 40.0 hours')
  })

  it('rounds a non-integer hours value to tenths instead of rendering a raw float', () => {
    const items: EvaluatedRequirement[] = [
      { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', current: 12.333333333333334, threshold: 40, satisfied: false },
    ]
    render(<CertificateChecklist isOwner={false} items={items} level="PP4" />)
    screen.getByText('12.3 / 40.0 hours')
  })

  it('renders a non-hours experience value as a plain integer, no decimal', () => {
    const items: EvaluatedRequirement[] = [
      { kind: 'experience', id: 'flights-over-1h', label: 'Single flights over 1 hour', unit: 'flights', current: 45, threshold: 3, satisfied: true },
    ]
    render(<CertificateChecklist isOwner={false} items={items} level="PP4" />)
    screen.getByText('45 / 3 flights')
  })

  it('shows an experience item\'s caveat as a footnote when it has one', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    screen.getByText('Only counts rows flightlog.org recorded as a single flight.')
  })

  it('renders no caveat footnote for an experience item that has none', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const hoursRow = screen.getByText('Total flight hours').closest('div.flex-col')
    expect(hoursRow?.querySelector('p')).toBeNull()
  })

  it('shows a satisfied tenure item as complete', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const tenureRow = screen.getByText('Held PP3 for at least 12 months').closest('li')
    expect(tenureRow?.textContent).toContain('✓')
  })

  it('renders a manual item as a disabled checkbox for a non-owner', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i })
    expect(checkbox.disabled).toBe(true)
    expect(checkbox.checked).toBe(false)
  })

  it('renders a manual item as an enabled checkbox for the owner, and toggles it on click', async () => {
    mockToggleAction.mockResolvedValue({ status: 'success' })
    render(<CertificateChecklist isOwner items={ITEMS} level="PP4" />)

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i })
    expect(checkbox.disabled).toBe(false)

    fireEvent.click(checkbox)

    expect(mockToggleAction).toHaveBeenCalledWith('PP4', 'safety-course', true)
    await screen.findByRole('checkbox', { checked: true, name: /completed the sikkerhetskurs/i })
  })

  it('reverts the checkbox when the toggle action fails', async () => {
    mockToggleAction.mockResolvedValue({ status: 'error', message: 'Something went wrong updating your checklist. Try again.' })
    render(<CertificateChecklist isOwner items={ITEMS} level="PP4" />)

    fireEvent.click(screen.getByRole('checkbox', { name: /completed the sikkerhetskurs/i }))

    await screen.findByText('Something went wrong updating your checklist. Try again.')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i }).checked).toBe(false)
  })
})
