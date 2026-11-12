import { describe, expect, it } from 'vitest'
import { formatLastChecked } from './format-last-checked'

const NOW = 1_000_000

describe('formatLastChecked', () => {
  it('says no recent requests for null', () => {
    expect(formatLastChecked(null, NOW)).toBe('no recent requests')
  })

  it('says less than 1 min for 0 seconds', () => {
    expect(formatLastChecked(NOW, NOW)).toBe('last checked less than 1 min ago')
  })

  it('says less than 1 min for 59 seconds', () => {
    expect(formatLastChecked(NOW - 59_000, NOW)).toBe('last checked less than 1 min ago')
  })

  it('says 1 min for 60 seconds', () => {
    expect(formatLastChecked(NOW - 60_000, NOW)).toBe('last checked 1 min ago')
  })

  it('says 5 min for 5 minutes', () => {
    expect(formatLastChecked(NOW - 300_000, NOW)).toBe('last checked 5 min ago')
  })
})
