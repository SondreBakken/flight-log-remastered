import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FollowButton as FollowButtonComponent } from './index'

const STORAGE_KEY = 'flight-log:followed-pilots'
const PILOT_ID = 42

function seedFollowedIds(ids: number[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
}

// use-follow-store.ts's storage module caches hydration state at module scope (the flag flips
// true on first read and never flips back), and Vitest isolates modules per file, not per test.
// A fresh instance per scenario is the only way each test's seeded localStorage is the one the
// hook actually reads — react and react-dom stay the same singleton across resets because they
// are CJS packages resolved through Node's own require cache, not Vitest's ESM module registry.
async function loadFreshFollowButton(): Promise<typeof FollowButtonComponent> {
  vi.resetModules()
  const followButtonModule = await import('./index')
  return followButtonModule.FollowButton
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('FollowButton', () => {
  it('renders as followed when the pilot is already in localStorage before mount', async () => {
    seedFollowedIds([PILOT_ID])
    const FollowButton = await loadFreshFollowButton()

    render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = screen.getByRole('button')

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.textContent).toBe('Following')
  })

  it('renders as not followed when localStorage lists other pilots but not this one', async () => {
    seedFollowedIds([999])
    const FollowButton = await loadFreshFollowButton()

    render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = screen.getByRole('button')

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.textContent).toBe('Follow')
  })

  it('toggles between followed and unfollowed in the DOM on click', async () => {
    seedFollowedIds([])
    const FollowButton = await loadFreshFollowButton()

    render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toBe('Following')

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toBe('Follow')
  })
})
