import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'
import { isPilotVerified } from './is-pilot-verified'

function fakeSupabaseRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  const client = { rpc } as unknown as SupabaseClient
  return { client, rpc }
}

describe('isPilotVerified', () => {
  it('calls the RPC with the exact parameter name and returns true for a verified pilot', async () => {
    const { client, rpc } = fakeSupabaseRpc({ data: true, error: null })

    const verified = await isPilotVerified(client, 12677)

    expect(verified).toBe(true)
    expect(rpc).toHaveBeenCalledWith('is_pilot_verified', { target_pilot_id: 12677 })
  })

  it('returns false for a pilot without a verified link', async () => {
    const { client } = fakeSupabaseRpc({ data: false, error: null })

    expect(await isPilotVerified(client, 12677)).toBe(false)
  })

  it('throws a ProfilesQueryError preserving the original error as cause on an RPC error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpcError = { message: 'function public.is_pilot_verified(integer) does not exist' }
    const { client } = fakeSupabaseRpc({ data: null, error: rpcError })

    const error = await isPilotVerified(client, 12677).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(rpcError)

    consoleError.mockRestore()
  })
})
