import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8')
const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8')

const TOKENS = {
  paper: ['#FFFFFF', '#09090B'],
  entry: ['#1B1F1D', '#E8ECEA'],
  muted: ['#6E7471', '#9AA09C'],
  form: ['#2E5E4E', '#8FC2AA'],
  rule: ['#B9CFC4', '#2F4A40'],
  frame: ['#8A8F8C', '#5E6360'],
  stamp: ['#5B3FA0', '#B7A5EE'],
} as const

/** Body of the first top-level block whose header matches `header`. */
function blockBody(source: string, header: RegExp): string {
  const match = header.exec(source)
  if (!match) throw new Error(`no block matching ${header}`)
  let depth = 1
  let i = match.index + match[0].length
  const start = i
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
  }
  return source.slice(start, i - 1)
}

const lightRoot = blockBody(css, /^:root\s*\{/m)
const darkRoot = blockBody(
  blockBody(css, /@media \(prefers-color-scheme: dark\)\s*\{/),
  /:root\s*\{/,
)
const theme = blockBody(css, /@theme inline\s*\{/)
const base = blockBody(css, /@layer base\s*\{/)

describe('identity foundation: font', () => {
  it('uses Archivo with the width axis and no Geist or Arial', () => {
    expect(layout).toMatch(/import \{ Archivo \} from 'next\/font\/google'/)
    const call = blockBody(layout, /Archivo\(\{/)
    expect(call).toContain("variable: '--font-archivo'")
    expect(call).toContain("subsets: ['latin', 'latin-ext']")
    expect(call).toContain("weight: 'variable'")
    expect(call).toContain("axes: ['wdth']")
    for (const source of [layout, css]) {
      expect(source).not.toMatch(/geist|arial/i)
    }
  })

  it('maps font-sans to the Archivo variable and drops font-mono', () => {
    expect(theme).toContain('--font-sans: var(--font-archivo);')
    expect(theme).not.toContain('--font-mono')
    expect(layout).toContain('${archivo.variable}')
  })
})

describe('identity foundation: ink tokens', () => {
  for (const [name, [light, dark]] of Object.entries(TOKENS)) {
    it(`--${name} has light ${light} and dark ${dark}`, () => {
      expect(lightRoot).toContain(`--${name}: ${light};`)
      expect(darkRoot).toContain(`--${name}: ${dark};`)
      expect(theme).toContain(`--color-${name}: var(--${name});`)
    })
  }

  it('removes background and foreground tokens', () => {
    expect(css).not.toMatch(/--(color-)?(background|foreground)/)
  })

  it('styles body from the tokens, not Tailwind colour classes', () => {
    const body = blockBody(base, /^\s*body\s*\{/m)
    expect(body).toContain('background: var(--paper);')
    expect(body).toContain('color: var(--entry);')
    expect(body).toContain('font-family: var(--font-sans);')
    const bodyTag = /<body className="([^"]*)"/.exec(layout)?.[1] ?? ''
    expect(bodyTag).toBe('flex min-h-full flex-col')
  })
})

describe('identity foundation: font-condensed and form-label utilities', () => {
  it('defines font-condensed as 75% font-stretch', () => {
    const body = blockBody(css, /@utility font-condensed\s*\{/)
    expect(body).toContain('font-stretch: 75%;')
  })

  it('defines form-label as small condensed medium form-coloured text without case or tracking changes', () => {
    const body = blockBody(css, /@utility form-label\s*\{/)
    expect(body).toContain('@apply font-condensed;')
    expect(body).toContain('font-size: 0.75rem;')
    expect(body).toContain('font-weight: 500;')
    expect(body).toContain('color: var(--form);')
    expect(body).not.toContain('text-transform')
    expect(body).not.toContain('letter-spacing')
  })
})

describe('identity foundation: base link and focus styles', () => {
  it('underlines links inside main in rule colour', () => {
    const rule = blockBody(base, /^\s*main a\s*\{/m)
    expect(rule).toContain('text-decoration-line: underline;')
    expect(rule).toContain('text-decoration-thickness: 1px;')
    expect(rule).toContain('text-decoration-color: var(--rule);')
  })

  it('turns the underline form-coloured on hover and focus-visible', () => {
    const rule = blockBody(base, /main a:hover,\s*main a:focus-visible\s*\{/)
    expect(rule).toContain('text-decoration-color: var(--form);')
  })

  it('draws a global form-coloured focus ring', () => {
    const rule = blockBody(base, /^\s*:focus-visible\s*\{/m)
    expect(rule).toContain('outline: 2px solid var(--form);')
    expect(rule).toContain('outline-offset: 2px;')
  })

  it('sets the root title template, default and flightlog.social description', () => {
    expect(layout).toContain(
      "title: { default: 'Flightlog Social', template: '%s | Flightlog Social' }",
    )
    expect(layout).toContain(
      "description: 'Pilots, flights, takeoffs and clubs from flightlog.org, on flightlog.social.'",
    )
  })

  it.each([
    ['countries/page.tsx', 'Countries'],
    ['pilots/search/page.tsx', 'Find pilots'],
    ['account/page.tsx', 'Account'],
    ['account/activity/page.tsx', 'Activity'],
    ['sign-in/page.tsx', 'Sign in'],
  ])('gives %s the static page title %j', (file, title) => {
    const page = readFileSync(join(__dirname, file), 'utf8')
    expect(page).toContain(`export const metadata: Metadata = { title: '${title}' }`)
  })
})
