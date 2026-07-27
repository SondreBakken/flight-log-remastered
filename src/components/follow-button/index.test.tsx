import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
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
//
// Each reset leaves the previous instance's `window.addEventListener('storage', ...)` listener
// registered (storage.ts's module-scope side effect has no matching removeEventListener), bound
// to that instance's own snapshot and subscribers. It's inert here because nothing in this file
// dispatches a `storage` event. A test that does belongs in its own file: dispatching one would
// fan out across every stale listener accumulated by earlier tests in this file, and the outcome
// would depend on test order rather than on the test itself.
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

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Following')
  })

  it('renders as not followed when localStorage lists other pilots but not this one', async () => {
    seedFollowedIds([999])
    const FollowButton = await loadFreshFollowButton()

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Follow')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toBe('rounded border px-3 py-1.5 text-sm border-black/20 dark:border-white/25')
  })

  it('renders the compact variant with its own class set', async () => {
    seedFollowedIds([PILOT_ID])
    const FollowButton = await loadFreshFollowButton()

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="compact" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')

    expect(button.className).toBe(
      'rounded border px-2 py-0.5 text-xs border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10',
    )
  })

  it('toggles between followed and unfollowed in the DOM on click', async () => {
    seedFollowedIds([])
    const FollowButton = await loadFreshFollowButton()

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toBe('Following')

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toBe('Follow')
  })
})
