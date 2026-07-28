import { describe, expect, it } from 'vitest'
import { buildRecord } from './build-record'

type Kind = 'a' | 'b' | 'c'
const KIND_WITNESS: Record<Kind, unknown> = { a: 1, b: 1, c: 1 }

describe('buildRecord', () => {
  it('computes one value per key of the exhaustive source record', () => {
    expect(buildRecord(KIND_WITNESS, (key) => key.toUpperCase())).toEqual({ a: 'A', b: 'B', c: 'C' })
  })

  it('passes each of the source record\'s own keys through untouched, in no particular order', () => {
    const seen: string[] = []
    buildRecord(KIND_WITNESS, (key) => {
      seen.push(key)
      return key
    })
    expect(seen.sort()).toEqual(['a', 'b', 'c'])
  })
})
