import { afterEach, describe, expect, it } from 'vitest'
import { isMapDebugEnabled } from './map-debug'

function setSearch(search: string): void {
  window.history.pushState(null, '', `/${search}`)
}

// #47: this gate is the whole fix — a build-time NODE_ENV check would strip the verification
// handle from a `next start` bundle unconditionally, since `next start` always runs in
// production. This is the one piece of that fix small and pure enough to pin with a direct
// unit test rather than only ever exercising it through a real production build.
describe('isMapDebugEnabled', () => {
  afterEach(() => {
    setSearch('')
  })

  it('is disabled on an ordinary navigation with no query string', () => {
    setSearch('')
    expect(isMapDebugEnabled()).toBe(false)
  })

  it('is disabled when unrelated query params are present but __verifyMap is not', () => {
    setSearch('?foo=bar')
    expect(isMapDebugEnabled()).toBe(false)
  })

  it('is enabled once __verifyMap is present, value-less', () => {
    setSearch('?__verifyMap')
    expect(isMapDebugEnabled()).toBe(true)
  })

  it('is enabled with __verifyMap alongside other params, in either order', () => {
    setSearch('?foo=bar&__verifyMap')
    expect(isMapDebugEnabled()).toBe(true)
  })
})
