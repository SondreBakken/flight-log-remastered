import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'

// confirm-pilot-verification.ts imports 'server-only' directly, which throws on plain import
// outside a react-server bundling context — mock it so this test can exercise the module's own
// contract (same convention as issue-pilot-verification.test.ts).
vi.mock('server-only', () => ({}))

import { confirmPilotVerification } from './confirm-pilot-verification'

// Local, minimal fake for the one method this module calls (`.rpc`) — mirrors
// issue-pilot-verification.test.ts's own fakeSupabaseRpc.
function fakeSupabaseRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  const client = { rpc } as unknown as SupabaseClient
  return { client, rpc }
}

describe('confirmPilotVerification', () => {
  it('calls the RPC with the exact parameter name and returns confirmed on a true result', async () => {
    const { client, rpc } = fakeSupabaseRpc({ data: true, error: null })

    const result = await confirmPilotVerification(client, '123456')

    expect(result).toEqual({ kind: 'confirmed' })
    expect(rpc).toHaveBeenCalledWith('confirm_pilot_verification', { submitted_code: '123456' })
  })

  it('returns incorrect-or-expired on a false result, not an error', async () => {
    const { client } = fakeSupabaseRpc({ data: false, error: null })

    const result = await confirmPilotVerification(client, '000000')

    expect(result).toEqual({ kind: 'incorrect-or-expired' })
  })

  it('returns a distinguishable locked-out outcome, not a thrown error, when the RPC raises AL001', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseRpc({
      data: null,
      error: { code: 'AL001', message: 'too many failed verification attempts; request a new code' },
    })

    const result = await confirmPilotVerification(client, '000000')

    expect(result).toEqual({ kind: 'locked-out' })
    consoleError.mockRestore()
  })

  it('throws a ProfilesQueryError, preserving the original error as cause, on a genuine unexpected RPC error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { code: '57014', message: 'canceling statement due to statement timeout' }
    const { client } = fakeSupabaseRpc({ data: null, error: queryError })

    const error = await confirmPilotVerification(client, '123456').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)

    consoleError.mockRestore()
  })
})
