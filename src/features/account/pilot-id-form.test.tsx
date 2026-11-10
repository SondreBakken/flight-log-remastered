import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PilotIdForm } from './pilot-id-form'
import type { OwnPilotVerificationState } from './pilot-verification'

vi.mock('./actions', () => ({
  saveFlightlogPilotId: vi.fn(),
}))

const NOTE = 'Self-declared, unverified.'
const LINKED_PILOT_ID = 12677
const PENDING: OwnPilotVerificationState = {
  kind: 'pending',
  email: 'pilot@example.com',
  otpExpiresAt: new Date('2026-08-13T10:32:00.000Z'),
}

const CASES: { name: string; initialPilotId: number | null; status: OwnPilotVerificationState; visible: boolean }[] = [
  { name: 'linked and verified', initialPilotId: LINKED_PILOT_ID, status: { kind: 'verified' }, visible: false },
  { name: 'linked and none', initialPilotId: LINKED_PILOT_ID, status: { kind: 'none' }, visible: true },
  { name: 'linked and pending', initialPilotId: LINKED_PILOT_ID, status: PENDING, visible: true },
  { name: 'linked and error', initialPilotId: LINKED_PILOT_ID, status: { kind: 'error' }, visible: false },
  { name: 'not linked and none', initialPilotId: null, status: { kind: 'none' }, visible: false },
]

describe('PilotIdForm unverified note', () => {
  it.each(CASES)('$name: note visible is $visible', ({ initialPilotId, status, visible }) => {
    render(<PilotIdForm initialPilotId={initialPilotId} verificationStatus={status} />)
    expect(screen.queryByText(NOTE) !== null).toBe(visible)
  })

  it('removes the note when the status changes from pending to verified, and restores it on verified to none', () => {
    const { rerender } = render(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verificationStatus={PENDING} />)
    expect(screen.getByText(NOTE)).toBeTruthy()

    rerender(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verificationStatus={{ kind: 'verified' }} />)
    expect(screen.queryByText(NOTE)).toBeNull()

    rerender(<PilotIdForm initialPilotId={LINKED_PILOT_ID} verificationStatus={{ kind: 'none' }} />)
    expect(screen.getByText(NOTE)).toBeTruthy()
  })
})
