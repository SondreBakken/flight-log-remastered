import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PilotIdForm } from './pilot-id-form'
import type { OwnPilotVerificationState } from './pilot-verification'

const mockSaveFlightlogPilotId = vi.fn()

vi.mock('./actions', () => ({
  saveFlightlogPilotId: (...args: unknown[]) => mockSaveFlightlogPilotId(...args),
}))

const EDIT_PILOT_ID = 'Edit pilot id'
const NOTE = 'Self-declared, unverified.'
const LINKED_PILOT_ID = 12677
const NONE: OwnPilotVerificationState = { kind: 'none' }
const VERIFIED: OwnPilotVerificationState = { kind: 'verified' }
const PENDING: OwnPilotVerificationState = {
  kind: 'pending',
  email: 'pilot@example.com',
  otpExpiresAt: new Date('2026-08-13T10:32:00.000Z'),
}

beforeEach(() => {
  mockSaveFlightlogPilotId.mockReset()
})

const CASES: { name: string; initialPilotId: number | null; verification: OwnPilotVerificationState; visible: boolean }[] = [
  { name: 'linked and verified', initialPilotId: LINKED_PILOT_ID, verification: VERIFIED, visible: false },
  { name: 'linked and none', initialPilotId: LINKED_PILOT_ID, verification: NONE, visible: true },
  { name: 'linked and pending', initialPilotId: LINKED_PILOT_ID, verification: PENDING, visible: true },
  { name: 'linked and error', initialPilotId: LINKED_PILOT_ID, verification: { kind: 'error' }, visible: true },
  { name: 'not linked and none', initialPilotId: null, verification: NONE, visible: false },
]

describe('PilotIdForm unverified note', () => {
  it.each(CASES)('$name: note visible is $visible', ({ initialPilotId, verification, visible }) => {
    render(<PilotIdForm initialPilotId={initialPilotId} verification={verification} />)
    expect(screen.queryByText(NOTE) !== null).toBe(visible)
  })

  it('keeps the note hidden after a save while a stale verified prop is passed, then shows it once the refreshed none arrives', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })
    const onSaved = vi.fn()
    const { rerender } = render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} onSaved={onSaved} verification={VERIFIED} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    fireEvent.change(screen.getByLabelText('flightlog.org pilot id'), { target: { value: '99999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved.')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(NOTE)).toBeNull()

    rerender(<PilotIdForm initialPilotId={99999} onSaved={onSaved} verification={NONE} />)
    expect(screen.getByText(NOTE)).toBeTruthy()
  })
})

describe('PilotIdForm text view', () => {
  it('shows a linked id as text with a pencil, and no input or Save button', () => {
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    expect(screen.getByText(String(LINKED_PILOT_ID))).toBeTruthy()
    expect(screen.getByRole('button', { name: EDIT_PILOT_ID }).getAttribute('type')).toBe('button')
    expect(screen.queryByLabelText('flightlog.org pilot id')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('opens the form prefilled with the current id when the pencil is clicked', () => {
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))

    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('value', String(LINKED_PILOT_ID))
  })

  it('shows the form directly, with no pencil, when no id is linked', () => {
    render(<PilotIdForm initialPilotId={null} verification={NONE} />)

    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('value', '')
    expect(screen.queryByRole('button', { name: EDIT_PILOT_ID })).toBeNull()
  })

  it('shows the disabled form and notice, with no text or pencil, when the load failed', () => {
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} pilotIdLoadFailed verification={NONE} />)

    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('disabled', true)
    expect(screen.getByText(/Couldn't load your current flightlog.org pilot id/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: EDIT_PILOT_ID })).toBeNull()
    expect(screen.queryByText(String(LINKED_PILOT_ID))).toBeNull()
  })

  it('closes the form and shows Saved. after a successful save, and hides Saved. once reopened', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved.')
    expect(screen.queryByLabelText('flightlog.org pilot id')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('keeps the form open with the message and does not call onSaved when the save errors', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'error', message: 'Unknown pilot id.' })
    const onSaved = vi.fn()
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} onSaved={onSaved} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Unknown pilot id.')
    expect(screen.getByLabelText('flightlog.org pilot id')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('PilotIdForm focus and note placement', () => {
  it('focuses the input when the pencil opens the form', () => {
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))

    expect(document.activeElement).toBe(screen.getByLabelText('flightlog.org pilot id'))
  })

  it('does not steal focus when the form is shown on first mount', () => {
    render(<PilotIdForm initialPilotId={null} verification={NONE} />)

    expect(document.activeElement).toBe(document.body)
  })

  it('returns focus to the pencil when a first save closes a form that opened on mount', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })
    const { rerender } = render(<PilotIdForm initialPilotId={null} verification={NONE} />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(LINKED_PILOT_ID) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockSaveFlightlogPilotId).toHaveBeenCalled())
    rerender(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: EDIT_PILOT_ID })))
  })

  it('returns focus to the pencil after a successful save', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: EDIT_PILOT_ID })))
  })

  it('leaves focus alone when the save errors', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'error', message: 'Unknown pilot id.' })
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.click(save)

    await screen.findByText('Unknown pilot id.')
    expect(document.activeElement).toBe(save)
  })

  it('renders the note directly under the row, before the Saved. paragraph', async () => {
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })
    render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verification={NONE} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_PILOT_ID }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = await screen.findByText('Saved.')
    const note = screen.getByText(NOTE)
    expect(note.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
