import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PilotIdForm } from './pilot-id-form'
import type { OwnPilotVerificationState } from './pilot-verification'

const mockSaveFlightlogPilotId = vi.fn()

vi.mock('./actions', () => ({
  saveFlightlogPilotId: (...args: unknown[]) => mockSaveFlightlogPilotId(...args),
}))

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

    fireEvent.change(screen.getByLabelText('flightlog.org pilot id'), { target: { value: '99999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved.')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(NOTE)).toBeNull()

    rerender(<PilotIdForm initialPilotId={99999} onSaved={onSaved} verification={NONE} />)
    expect(screen.getByText(NOTE)).toBeTruthy()
  })
})
