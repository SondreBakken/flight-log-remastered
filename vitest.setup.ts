import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Next's bundler resolves 'server-only' to a no-op for server code, but Vitest has no
// react-server condition, so the guard would throw on import of every server module, including
// the auth helper that server actions pull into client component tests.
vi.mock('server-only', () => ({}))

// @testing-library/react's auto-cleanup only fires when it finds a global `afterEach`.
// Test files here import from 'vitest' explicitly instead of relying on injected globals,
// so that global never exists — wire cleanup up by hand instead.
afterEach(() => {
  cleanup()
})
