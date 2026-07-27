import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FollowButton } from './index'

// A plain Testing Library render() uses createRoot, which only ever calls
// useSyncExternalStore's SECOND argument (getSnapshot) — the pre-hydration branch, driven by
// the THIRD argument (getServerSnapshot), is unreachable that way. renderToStaticMarkup uses a
// separate server dispatcher that always calls the third argument, so it is the only way to
// exercise that branch. Kept in its own file (rather than reset alongside index.test.tsx's
// scenarios) because Vitest isolates modules per file: this file's follow-store module starts
// genuinely unhydrated, with no risk of a leaked listener or a stale hydrated snapshot from
// another test bleeding in.
const STORAGE_KEY = 'flight-log:followed-pilots'
const PILOT_ID = 42

describe('FollowButton server render', () => {
  it('renders the neutral, disabled, unpressed form even when localStorage already lists the pilot as followed', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([PILOT_ID]))

    const markup = renderToStaticMarkup(<FollowButton pilotId={PILOT_ID} variant="prominent" />)
    const container = document.createElement('div')
    container.innerHTML = markup
    const button = container.querySelector('button')
    if (button === null) throw new Error('expected the server-rendered markup to contain a button')

    expect(button.hasAttribute('aria-pressed')).toBe(false)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Follow')
  })
})
