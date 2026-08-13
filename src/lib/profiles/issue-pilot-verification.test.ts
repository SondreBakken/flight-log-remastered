import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'

// issue-pilot-verification.ts imports 'server-only' directly, which throws on plain import
// outside a react-server bundling context — mock it so this test can exercise the module's own
// contract (same convention as send-verification-email.test.ts / admin.test.ts).
vi.mock('server-only', () => ({}))

import { issuePilotVerification } from './issue-pilot-verification'

// Local, minimal fake for the one method this module calls (`.rpc`) — narrower than
// fake-supabase-query.ts's `.from(...)` chain builder, which this module never touches, so that
// helper (shared by comments/follows tests) isn't reused here. Mirrors this repo's own
// "inject a narrow interface over just the call it needs" convention.
function fakeSupabaseRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  const client = { rpc } as unknown as SupabaseClient
  return { client, rpc }
}

describe('issuePilotVerification', () => {
  it('generates a code, calls the RPC with the exact parameter names, and returns the same code', async () => {
    const { client, rpc } = fakeSupabaseRpc({ data: 4549, error: null })

    const result = await issuePilotVerification(client, 'user-1', 'pilot@example.com')

    expect(result.kind).toBe('issued')
    const issuedCode = result.kind === 'issued' ? result.code : null
    expect(issuedCode).toMatch(/^\d{6}$/)

    expect(rpc).toHaveBeenCalledWith('issue_pilot_verification', {
      target_user_id: 'user-1',
      scraped_email: 'pilot@example.com',
      code: issuedCode,
    })
  })

  it('returns the RPC-reported bound pilot id alongside the code, not just success/failure', async () => {
    const { client } = fakeSupabaseRpc({ data: 4549, error: null })

    const result = await issuePilotVerification(client, 'user-1', 'pilot@example.com')

    expect(result.kind).toBe('issued')
    expect(result.kind === 'issued' ? result.boundPilotId : null).toBe(4549)
  })

  it('returns a distinguishable no-linked-pilot-id outcome, not a thrown error, when the RPC raises P0001', async () => {
    const { client } = fakeSupabaseRpc({
      data: null,
      error: { code: 'P0001', message: 'no flightlog pilot id linked to the target profile' },
    })

    const result = await issuePilotVerification(client, 'user-1', 'pilot@example.com')

    expect(result).toEqual({ kind: 'no-linked-pilot-id' })
  })

  it('throws a ProfilesQueryError, preserving the original error as cause, on a genuine unexpected RPC error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { code: '57014', message: 'canceling statement due to statement timeout' }
    const { client } = fakeSupabaseRpc({ data: null, error: queryError })

    const error = await issuePilotVerification(client, 'user-1', 'pilot@example.com').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)

    consoleError.mockRestore()
  })

  it('throws a ProfilesQueryError naming the migration, rather than silently treating it as a pilot-id mismatch, when the RPC has no error but returns non-numeric data (the old `returns void` function still live because 20260813010000 hasn\'t been applied yet)', async () => {
    const { client } = fakeSupabaseRpc({ data: null, error: null })

    const error = await issuePilotVerification(client, 'user-1', 'pilot@example.com').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).message).toContain('20260813010000_fix_issue_pilot_verification_toctou.sql')
  })
})
