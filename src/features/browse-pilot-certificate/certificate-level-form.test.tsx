import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CertificateLevelForm } from './certificate-level-form'

const mockSaveCertificateLevelAction = vi.fn()
vi.mock('./actions', () => ({ saveCertificateLevelAction: (...args: unknown[]) => mockSaveCertificateLevelAction(...args) }))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

beforeEach(() => {
  mockSaveCertificateLevelAction.mockReset()
  mockRefresh.mockReset()
})

function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: /edit certificate level/i }))
}

describe('CertificateLevelForm, collapsed (default) view', () => {
  it('shows the current level as plain text, not the select', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    screen.getByText('PP3')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows "Not set" when no level is declared yet', () => {
    render(<CertificateLevelForm currentLevel={null} />)
    screen.getByText('Not set')
  })

  it('always renders the edit icon button', () => {
    render(<CertificateLevelForm currentLevel={null} />)
    screen.getByRole('button', { name: /edit certificate level/i })
  })
})

describe('CertificateLevelForm, expanding and collapsing', () => {
  it('reveals the select and Save button when the edit icon is clicked', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('PP3')
    screen.getByRole('button', { name: /^save$/i })
  })

  it('preselects the current level when opened', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('PP3')
  })

  it('shows a placeholder option when no level is declared yet', () => {
    render(<CertificateLevelForm currentLevel={null} />)
    openEditor()
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
  })

  it('collapses back to the plain-text view without saving when the edit icon is clicked again', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: /close certificate level editor/i }))

    expect(screen.queryByRole('combobox')).toBeNull()
    screen.getByText('PP3')
    expect(mockSaveCertificateLevelAction).not.toHaveBeenCalled()
  })
})

describe('CertificateLevelForm, saving', () => {
  it('saves the selected level on submit and collapses back to the new plain-text value', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'success' })
    const { rerender } = render(<CertificateLevelForm currentLevel={null} />)
    openEditor()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PP4' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
    expect(screen.queryByText('PP4')).toBeNull()
    screen.getByText('Not set')

    rerender(<CertificateLevelForm currentLevel="PP4" />)
    screen.getByText('PP4')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(mockSaveCertificateLevelAction).toHaveBeenCalledWith('PP4')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the error message and stays open when saving fails', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'error', message: 'Something went wrong saving your certificate level. Try again.' })
    render(<CertificateLevelForm currentLevel="PP2" />)
    openEditor()

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Something went wrong saving your certificate level. Try again.')
    screen.getByRole('combobox')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('CertificateLevelForm focus', () => {
  it('focuses the select when the editor opens', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()

    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })

  it('returns focus to the pencil after a successful save', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'success' })
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /edit certificate level/i })))
  })

  it('leaves the pencil focused after the toggle-close click', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: /close certificate level editor/i }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /edit certificate level/i }))
  })

  it('shows the note only while editing, after the form', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    expect(screen.queryByText('Self-declared, unverified.')).toBeNull()

    openEditor()
    const note = screen.getByText('Self-declared, unverified.')
    expect(screen.getByRole('combobox').compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
