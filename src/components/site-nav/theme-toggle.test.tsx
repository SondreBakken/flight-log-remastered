import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ThemeToggle from './theme-toggle'

afterEach(() => {
  delete document.documentElement.dataset.theme
  document.cookie = 'theme=; path=/; max-age=0'
})

describe('ThemeToggle', () => {
  it('is a button offering the dark theme when the page is light', () => {
    render(<ThemeToggle />)

    const button = screen.getByRole('button', { name: 'Switch to dark theme' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.querySelector('svg')?.classList.contains('lucide-moon')).toBe(true)
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('reads the current theme from the html attribute after mount', () => {
    document.documentElement.dataset.theme = 'dark'
    render(<ThemeToggle />)

    const button = screen.getByRole('button', { name: 'Switch to light theme' })
    expect(button.querySelector('svg')?.classList.contains('lucide-sun')).toBe(true)
  })

  it('flips the attribute and writes the cookie on click, and flips back', () => {
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.cookie).toContain('theme=dark')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.cookie).toContain('theme=light')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy()
  })

  it('writes the cookie with a one-year lifetime, site-wide path and SameSite=Lax', () => {
    const writes: string[] = []
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => writes.push(value),
    })
    try {
      render(<ThemeToggle />)
      fireEvent.click(screen.getByRole('button'))
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie
      Object.defineProperty(Document.prototype, 'cookie', descriptor)
    }
    expect(writes).toEqual(['theme=dark; path=/; max-age=31536000; SameSite=Lax'])
  })

  it('is keyboard focusable and keeps the global focus outline', () => {
    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    button.focus()
    expect(document.activeElement === button).toBeTruthy()
    expect(button.className).not.toContain('outline-none')
    expect(button.className).not.toContain('outline-0')
  })
})
