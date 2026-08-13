import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { ProfilesQueryError } from './profiles-query-error'
import { getFlightlogPilotIds } from './get-flightlog-pilot-ids'

describe('getFlightlogPilotIds', () => {
  it('resolves the queried rows into a Map keyed by user id', async () => {
    const rows = [
      { user_id: 'user-1', flightlog_pilot_id: 12677 },
      { user_id: 'user-2', flightlog_pilot_id: null },
    ]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getFlightlogPilotIds(client, ['user-1', 'user-2'])

    expect(builder.in).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
    expect(result).toEqual(
      new Map([
        ['user-1', 12677],
        ['user-2', null],
      ]),
    )
  })

  it('short-circuits to an empty Map without querying when userIds is empty', async () => {
    const { client } = fakeSupabaseQuery({ data: null, error: null })

    const result = await getFlightlogPilotIds(client, [])

    expect(result).toEqual(new Map())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('throws a ProfilesQueryError, distinguishably from an empty Map, on a generic query error, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table profiles' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getFlightlogPilotIds(client, ['user-1']).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)

    consoleError.mockRestore()
  })

  // Regression guard for the deliberate 42703 carve-out (mirrored from #149/#151's identical
  // branch on get-display-names.ts): unlike every other error code, a missing flightlog_pilot_id
  // column must stay a soft degrade to an empty Map, not a throw.
  it('returns an empty Map, and does not throw, when the query fails with 42703 (undefined_column)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseQuery({
      data: null,
      error: { code: '42703', message: 'column profiles.flightlog_pilot_id does not exist' },
    })

    const result = await getFlightlogPilotIds(client, ['user-1'])

    expect(result).toEqual(new Map())
    consoleError.mockRestore()
  })
})
