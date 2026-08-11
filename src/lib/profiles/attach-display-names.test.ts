import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockGetDisplayNames = vi.fn()

vi.mock('./get-display-names', () => ({
  getDisplayNames: (...args: unknown[]) => mockGetDisplayNames(...args),
}))

import { attachDisplayNames } from './attach-display-names'

const fakeSupabase = {} as SupabaseClient

type Row = { user_id: string; value: string }
type Out = { userId: string; value: string; displayName: string | null }

function toRow(row: Row, displayNames: Map<string, string | null>): Out {
  return { userId: row.user_id, value: row.value, displayName: displayNames.get(row.user_id) ?? null }
}

describe('attachDisplayNames', () => {
  it('calls getDisplayNames with the deduped user ids', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map())
    const rows: Row[] = [
      { user_id: 'user-1', value: 'a' },
      { user_id: 'user-1', value: 'b' },
      { user_id: 'user-2', value: 'c' },
    ]

    await attachDisplayNames(fakeSupabase, rows, toRow)

    expect(mockGetDisplayNames).toHaveBeenCalledWith(fakeSupabase, ['user-1', 'user-2'])
  })

  it('returns [] for an empty rows array', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map())

    const result = await attachDisplayNames(fakeSupabase, [], toRow)

    expect(result).toEqual([])
    expect(mockGetDisplayNames).toHaveBeenCalledWith(fakeSupabase, [])
  })

  it('passes the resolved Map through to toRow, leaving a missing profile as an absent entry', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map([['user-1', 'Alice']]))
    const rows: Row[] = [
      { user_id: 'user-1', value: 'a' },
      { user_id: 'user-2', value: 'b' },
    ]

    const result = await attachDisplayNames(fakeSupabase, rows, toRow)

    expect(result).toEqual([
      { userId: 'user-1', value: 'a', displayName: 'Alice' },
      { userId: 'user-2', value: 'b', displayName: null },
    ])
  })

  it('preserves input row order in the output', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map())
    const rows: Row[] = [
      { user_id: 'user-3', value: 'first' },
      { user_id: 'user-1', value: 'second' },
      { user_id: 'user-2', value: 'third' },
    ]

    const result = await attachDisplayNames(fakeSupabase, rows, toRow)

    expect(result.map((out) => out.value)).toEqual(['first', 'second', 'third'])
  })
})
