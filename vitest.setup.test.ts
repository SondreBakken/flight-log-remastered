import { beforeEach, describe, expect, it } from 'vitest'

describe('localStorage in the test environment', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('has a working clear()', () => {
    expect(typeof localStorage.clear).toBe('function')
  })

  it('round-trips a value and returns null for a missing key', () => {
    localStorage.setItem('k', 'v')

    expect(localStorage.getItem('k')).toBe('v')
    expect(localStorage.getItem('missing')).toBeNull()
  })

  it('empties on clear()', () => {
    localStorage.setItem('k', 'v')
    localStorage.clear()

    expect(localStorage.getItem('k')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('reports length and key(index)', () => {
    localStorage.setItem('first', 'a')
    localStorage.setItem('second', 'b')

    expect(localStorage.length).toBe(2)
    expect(localStorage.key(0)).toBe('first')
    expect(localStorage.key(2)).toBeNull()
  })

  it('removes a single key', () => {
    localStorage.setItem('k', 'v')
    localStorage.removeItem('k')

    expect(localStorage.getItem('k')).toBeNull()
  })

  it('stringifies values on setItem', () => {
    localStorage.setItem('k', 1 as never)

    expect(localStorage.getItem('k')).toBe('1')
  })
})
