import { describe, expect, it } from 'vitest'
import { THEME_SCRIPT } from './theme-script'

function runWithCookie(cookie: string): string | undefined {
  const dataset: Record<string, string> = {}
  const fakeDocument = { cookie, documentElement: { dataset } }
  new Function('document', THEME_SCRIPT)(fakeDocument)
  return dataset.theme
}

describe('THEME_SCRIPT', () => {
  it.each([
    ['no cookie', '', undefined],
    ['theme=dark', 'theme=dark', 'dark'],
    ['theme=light', 'theme=light', undefined],
    ['theme=garbage', 'theme=garbage', undefined],
    ['theme=darkness', 'theme=darkness', undefined],
    ['other cookie named xtheme=dark', 'xtheme=dark', undefined],
    ['dark among other cookies', 'a=b; theme=dark', 'dark'],
    ['dark first among other cookies', 'theme=dark; a=b', 'dark'],
  ])('%s', (_name, cookie, expected) => {
    expect(runWithCookie(cookie)).toBe(expected)
  })

  it('does not throw when document access fails', () => {
    expect(() => new Function('document', THEME_SCRIPT)({})).not.toThrow()
  })
})
