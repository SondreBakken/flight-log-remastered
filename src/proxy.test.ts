// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from './proxy'

// Exercises the actual matcher regex Next.js compiles from `config.matcher` (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md, "Unit
// testing (experimental)") instead of re-deriving the pattern by hand — a hand-rolled
// `new RegExp(...)` over the raw matcher string doesn't reproduce Next's own compilation and
// silently passed paths (e.g. /api/*) it should have excluded.
function isMatched(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url: `http://localhost${pathname}` })
}

describe('proxy config.matcher', () => {
  it.each(['/countries', '/', '/pilots/search'])('matches ordinary page %s', (pathname) => {
    expect(isMatched(pathname)).toBe(true)
  })

  it.each([
    '/api/pilots/1/recent-flights',
    '/api/auth/sign-out',
    '/_next/static/chunks/main.js',
    '/_next/image?url=/foo.png',
    '/favicon.ico',
    '/logo.svg',
    '/photo.png',
    '/photo.jpg',
    '/photo.jpeg',
    '/photo.gif',
    '/photo.webp',
  ])('excludes %s', (pathname) => {
    expect(isMatched(pathname)).toBe(false)
  })
})
