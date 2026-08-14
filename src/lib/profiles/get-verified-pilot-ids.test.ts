import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { ProfilesQueryError } from './profiles-query-error'
import { getVerifiedPilotIds } from './get-verified-pilot-ids'

describe('getVerifiedPilotIds', () => {
  it('resolves to a Set containing only the pilot ids with a verified row', async () => {
    const rows = [
      { flightlog_pilot_id: 12677, status: 'verified' },
      { flightlog_pilot_id: 4549, status: 'pending' },
    ]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getVerifiedPilotIds(client, [12677, 4549])

    expect(builder.in).toHaveBeenCalledWith('flightlog_pilot_id', [12677, 4549])
    expect(result).toEqual(new Set([12677]))
  })

  // A pilot id with no profile_verifications row at all never appears in the returned rows in
  // the first place (nothing to filter out) — this pins that the Set stays empty, not that
  // filtering merely excludes a present-but-null status.
  it('omits a pilot id with no verification row at all, rather than erroring', async () => {
    const { client } = fakeSupabaseQuery({ data: [], error: null })

    const result = await getVerifiedPilotIds(client, [12677])

    expect(result).toEqual(new Set())
  })

  it('short-circuits to an empty Set without querying when pilotIds is empty', async () => {
    const { client } = fakeSupabaseQuery({ data: null, error: null })

    const result = await getVerifiedPilotIds(client, [])

    expect(result).toEqual(new Set())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('throws a ProfilesQueryError, distinguishably from an empty Set, on a query error, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table profile_verifications' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getVerifiedPilotIds(client, [12677]).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)

    consoleError.mockRestore()
  })
})
