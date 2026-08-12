import { describe, expect, it, vi } from 'vitest'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import { fakeFollowsSupabase } from '@/lib/testing/follows-query-builder-fake'

describe('getFollowedPilotIds', () => {
  it('returns the queried pilot ids as a Set', async () => {
    const { client } = fakeFollowsSupabase({ data: [{ pilot_id: 4549 }, { pilot_id: 12677 }], error: null })

    const result = await getFollowedPilotIds(client, 'user-abc')

    expect(result).toEqual(new Set([4549, 12677]))
  })

  it('short-circuits to an empty Set without querying when candidatePilotIds is an empty array', async () => {
    const { client } = fakeFollowsSupabase({ data: null, error: null })

    const result = await getFollowedPilotIds(client, 'user-abc', [])

    expect(result).toEqual(new Set())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('scopes the query with .in() when candidatePilotIds is given', async () => {
    const { client, builder } = fakeFollowsSupabase({ data: [], error: null })

    await getFollowedPilotIds(client, 'user-abc', [4549, 12677])

    expect(builder.in).toHaveBeenCalledWith('pilot_id', [4549, 12677])
  })

  it('throws, distinguishably from an empty Set, when the query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeFollowsSupabase({ data: null, error: { message: 'permission denied for table follows' } })

    await expect(getFollowedPilotIds(client, 'user-abc')).rejects.toThrow(/user-abc/)

    consoleError.mockRestore()
  })
})
