import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import type { FollowButton as FollowButtonComponent } from './index'

const STORAGE_KEY = 'flight-log:followed-pilots'
const WATERMARK_STORAGE_KEY = 'flight-log:track-watermarks'
const SEEN_TRIP_STORAGE_KEY = 'flight-log:seen-untracked-trips'
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

  it('drops the pilot\'s watermark AND seen-trip entry on unfollow — the explicit call issue #5 (extended by #62 to the seen-trip store) requires, so a later refollow shows their whole history as new again instead of comparing against a stale mark', async () => {
    seedFollowedIds([PILOT_ID])
    window.localStorage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify({ [PILOT_ID]: '20260101000000' }))
    window.localStorage.setItem(SEEN_TRIP_STORAGE_KEY, JSON.stringify({ [PILOT_ID]: [1, 2] }))
    const FollowButton = await loadFreshFollowButton()

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')
    expect(button.getAttribute('aria-pressed')).toBe('true') // sanity: starts followed

    fireEvent.click(button) // the only click direction that unfollows
    expect(button.getAttribute('aria-pressed')).toBe('false') // sanity: click actually unfollowed

    expect(JSON.parse(window.localStorage.getItem(WATERMARK_STORAGE_KEY) ?? '{}')).toEqual({})
    // check-seen-trip-store.mts's cross-store integration test replicates useFollowPilot's
    // toggle sequence by hand against the storage modules directly, which its own comment
    // notes cannot detect a regression in the PRODUCTION sequence itself (deleting
    // clearSeenTripIds from use-follow-store.ts, say) — only a test that actually drives
    // useFollowPilot/FollowButton, like this one, can (blocking finding, FIX section).
    expect(JSON.parse(window.localStorage.getItem(SEEN_TRIP_STORAGE_KEY) ?? '{}')).toEqual({})
  })

  it('does NOT touch the watermark or the seen-trip entry on follow — only unfollowing clears either', async () => {
    seedFollowedIds([])
    // Seeds a watermark AND a seen-trip entry for the PILOT BEING CLICKED, not just an
    // unrelated one: an unconditional clearWatermark(pilotId)/clearSeenTripIds(pilotId) call
    // (clearing on follow too, not just unfollow) would leave an unrelated pilot's stores
    // untouched either way, so asserting only that survives cannot tell "clears only on
    // unfollow" apart from "always clears the pilot just clicked". Seeding 999 too proves the
    // unrelated pilot really is unaffected by ANY call this click makes.
    window.localStorage.setItem(
      WATERMARK_STORAGE_KEY,
      JSON.stringify({ [PILOT_ID]: '20260101000000', 999: '20260101000000' }),
    )
    window.localStorage.setItem(SEEN_TRIP_STORAGE_KEY, JSON.stringify({ [PILOT_ID]: [1], 999: [2] }))
    const FollowButton = await loadFreshFollowButton()

    const { container } = render(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const button = within(container).getByRole<HTMLButtonElement>('button')

    fireEvent.click(button) // follows PILOT_ID — following must not clear ITS OWN stores either

    expect(JSON.parse(window.localStorage.getItem(WATERMARK_STORAGE_KEY) ?? '{}')).toEqual({
      [PILOT_ID]: '20260101000000',
      '999': '20260101000000',
    })
    expect(JSON.parse(window.localStorage.getItem(SEEN_TRIP_STORAGE_KEY) ?? '{}')).toEqual({
      [PILOT_ID]: [1],
      '999': [2],
    })
  })
})
