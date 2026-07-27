import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's auto-cleanup only fires when it finds a global `afterEach`.
// Test files here import from 'vitest' explicitly instead of relying on injected globals,
// so that global never exists — wire cleanup up by hand instead.
afterEach(() => {
  cleanup()
})
