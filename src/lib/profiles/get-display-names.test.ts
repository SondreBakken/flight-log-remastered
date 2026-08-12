import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { ProfilesQueryError } from './profiles-query-error'
import { getDisplayNames } from './get-display-names'

describe('getDisplayNames', () => {
  it('resolves the queried rows into a Map keyed by user id', async () => {
    const rows = [
      { user_id: 'user-1', display_name: 'Alice' },
      { user_id: 'user-2', display_name: null },
    ]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getDisplayNames(client, ['user-1', 'user-2'])

    expect(builder.in).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
    expect(result).toEqual(
      new Map([
        ['user-1', 'Alice'],
        ['user-2', null],
      ]),
    )
  })

  it('short-circuits to an empty Map without querying when userIds is empty', async () => {
    const { client } = fakeSupabaseQuery({ data: null, error: null })

    const result = await getDisplayNames(client, [])

    expect(result).toEqual(new Map())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('throws a ProfilesQueryError, distinguishably from an empty Map, on a generic query error, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table profiles' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getDisplayNames(client, ['user-1']).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)

    consoleError.mockRestore()
  })

  // Regression guard for the deliberate 42703 carve-out (#149/#151): unlike every other error
  // code, a missing display_name column must stay a soft degrade to an empty Map, not a throw.
  // Without this test, someone "fixing" the generic branch above could accidentally fold this
  // case into the new throw and silently break the transitional-migration handling this branch
  // exists for.
  it('returns an empty Map, and does not throw, when the query fails with 42703 (undefined_column)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseQuery({
      data: null,
      error: { code: '42703', message: 'column profiles.display_name does not exist' },
    })

    const result = await getDisplayNames(client, ['user-1'])

    expect(result).toEqual(new Map())
    consoleError.mockRestore()
  })
})
