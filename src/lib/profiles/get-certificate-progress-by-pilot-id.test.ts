import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { ProfilesQueryError } from './profiles-query-error'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'

describe('getCertificateProgressByPilotId', () => {
  it('returns the matching row, camelCased', async () => {
    const rows = [
      { user_id: 'user-1', certificate_level: 'PP3', certificate_level_set_at: '2026-01-01T00:00:00.000Z', certificate_checklist: { PP3: { 'theory-exam': true } } },
    ]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getCertificateProgressByPilotId(client, 12677)

    expect(builder.eq).toHaveBeenCalledWith('flightlog_pilot_id', 12677)
    expect(result).toEqual({
      userId: 'user-1',
      level: 'PP3',
      levelSetAt: '2026-01-01T00:00:00.000Z',
      checklist: { PP3: { 'theory-exam': true } },
    })
  })

  it('returns null when no profile has declared this pilot id', async () => {
    const { client } = fakeSupabaseQuery({ data: [], error: null })

    expect(await getCertificateProgressByPilotId(client, 12677)).toBeNull()
  })

  it('returns the first match when more than one profile self-declared the same pilot id', async () => {
    const rows = [
      { user_id: 'user-1', certificate_level: 'PP2', certificate_level_set_at: null, certificate_checklist: {} },
      { user_id: 'user-2', certificate_level: 'PP4', certificate_level_set_at: null, certificate_checklist: {} },
    ]
    const { client } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getCertificateProgressByPilotId(client, 12677)
    expect(result?.userId).toBe('user-1')
  })

  it('throws a ProfilesQueryError on a query error, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table profiles' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getCertificateProgressByPilotId(client, 12677).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)
    consoleError.mockRestore()
  })

  // Same known-transitional carve-out as get-flightlog-pilot-ids.ts: a missing column means the
  // migration hasn't been applied yet, not that every pilot genuinely has no certificate declared.
  it('returns null, and does not throw, when the query fails with 42703 (undefined_column)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseQuery({ data: null, error: { code: '42703', message: 'column does not exist' } })

    expect(await getCertificateProgressByPilotId(client, 12677)).toBeNull()
    consoleError.mockRestore()
  })
})
