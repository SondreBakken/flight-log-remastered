import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccountForm } from './account-form'

const mockSaveDisplayName = vi.fn()

vi.mock('./actions', () => ({
  saveDisplayName: (...args: unknown[]) => mockSaveDisplayName(...args),
}))

const EDIT_NAME = 'Edit display name'

beforeEach(() => {
  mockSaveDisplayName.mockReset()
})

describe('AccountForm text view', () => {
  it('shows a saved name as text with a pencil, and no input or Save button', () => {
    render(<AccountForm initialDisplayName="Alex" />)

    expect(screen.getByText('Alex')).toBeTruthy()
    expect(screen.getByRole('button', { name: EDIT_NAME }).getAttribute('type')).toBe('button')
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('opens the form prefilled with the current name when the pencil is clicked', () => {
    render(<AccountForm initialDisplayName="Alex" />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_NAME }))

    expect(screen.getByLabelText('Display name')).toHaveProperty('value', 'Alex')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it.each([null, '', '   '])('shows the form directly, with no pencil, for the blank name %j', (name) => {
    render(<AccountForm initialDisplayName={name} />)

    expect(screen.getByLabelText('Display name')).toHaveProperty('value', name ?? '')
    expect(screen.queryByRole('button', { name: EDIT_NAME })).toBeNull()
  })

  it('shows the disabled form and notice, with no text or pencil, when the load failed', () => {
    render(<AccountForm displayNameLoadFailed initialDisplayName="Alex" />)

    expect(screen.getByLabelText('Display name')).toHaveProperty('disabled', true)
    expect(screen.getByText(/Couldn't load your current display name/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: EDIT_NAME })).toBeNull()
    expect(screen.queryByText('Alex')).toBeNull()
  })
})

describe('AccountForm saving', () => {
  it('closes the form, shows Saved., and calls onSaved once after a successful save, then shows the refreshed name', async () => {
    mockSaveDisplayName.mockResolvedValue({ status: 'success' })
    const onSaved = vi.fn()
    const { rerender } = render(<AccountForm initialDisplayName="Alex" onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_NAME }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved.')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Display name')).toBeNull()

    rerender(<AccountForm initialDisplayName="Sam" onSaved={onSaved} />)
    expect(screen.getByText('Sam')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('hides Saved. while the form is reopened', async () => {
    mockSaveDisplayName.mockResolvedValue({ status: 'success' })
    render(<AccountForm initialDisplayName="Alex" />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_NAME }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')

    fireEvent.click(screen.getByRole('button', { name: EDIT_NAME }))
    expect(screen.queryByText('Saved.')).toBeNull()
    expect(screen.getByLabelText('Display name')).toBeTruthy()
  })

  it('keeps the form open with the message and does not call onSaved when the save errors', async () => {
    mockSaveDisplayName.mockResolvedValue({ status: 'error', message: 'Too long.' })
    const onSaved = vi.fn()
    render(<AccountForm initialDisplayName="Alex" onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: EDIT_NAME }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Too long.')
    expect(screen.getByLabelText('Display name')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
