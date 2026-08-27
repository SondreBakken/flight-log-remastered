import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CertificateLevelForm } from './certificate-level-form'

const mockSaveCertificateLevelAction = vi.fn()
vi.mock('./actions', () => ({ saveCertificateLevelAction: (...args: unknown[]) => mockSaveCertificateLevelAction(...args) }))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

beforeEach(() => {
  mockSaveCertificateLevelAction.mockReset()
  mockRefresh.mockReset()
})

describe('CertificateLevelForm', () => {
  it('preselects the current level', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('PP3')
  })

  it('shows a placeholder option when no level is declared yet', () => {
    render(<CertificateLevelForm currentLevel={null} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
  })

  it('saves the selected level on submit', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'success' })
    render(<CertificateLevelForm currentLevel={null} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PP4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText('Saved.')
    expect(mockSaveCertificateLevelAction).toHaveBeenCalledWith('PP4')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the error message when saving fails', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'error', message: 'Something went wrong saving your certificate level. Try again.' })
    render(<CertificateLevelForm currentLevel="PP2" />)

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText('Something went wrong saving your certificate level. Try again.')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
