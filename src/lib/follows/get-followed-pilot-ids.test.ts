import { describe, expect, it, vi } from 'vitest'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { FollowsQueryError } from './follows-query-error'

describe('getFollowedPilotIds', () => {
  it('returns the queried pilot ids as a Set', async () => {
    const { client } = fakeSupabaseQuery({ data: [{ pilot_id: 4549 }, { pilot_id: 12677 }], error: null })

    const result = await getFollowedPilotIds(client, 'user-abc')

    expect(result).toEqual(new Set([4549, 12677]))
  })

  it('short-circuits to an empty Set without querying when candidatePilotIds is an empty array', async () => {
    const { client } = fakeSupabaseQuery({ data: null, error: null })

    const result = await getFollowedPilotIds(client, 'user-abc', [])

    expect(result).toEqual(new Set())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('scopes the query with .in() when candidatePilotIds is given', async () => {
    const { client, builder } = fakeSupabaseQuery({ data: [], error: null })

    await getFollowedPilotIds(client, 'user-abc', [4549, 12677])

    expect(builder.in).toHaveBeenCalledWith('pilot_id', [4549, 12677])
  })

  it('throws, distinguishably from an empty Set, when the query errors, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table follows' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getFollowedPilotIds(client, 'user-abc').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/user-abc/)
    expect((error as FollowsQueryError).cause).toBe(queryError)
    consoleError.mockRestore()
  })
})
