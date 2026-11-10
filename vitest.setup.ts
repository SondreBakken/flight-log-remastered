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

// Node 25 enables webstorage by default and defines a global `localStorage` that shadows
// jsdom's; without --localstorage-file it has no working `clear()`. Replace it with an
// in-memory Storage so tests behave the same on Node 24 and 25.
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value))
  }
}

if (typeof globalThis.localStorage?.clear !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
}
