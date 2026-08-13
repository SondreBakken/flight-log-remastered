'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type OwnPilotVerificationStatusState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'pending'; otpExpiresAt: string; email: string }
  | { kind: 'verified' }
  | { kind: 'error' }

type VerificationRow = {
  status: string
  otp_expires_at: string | null
  email: string | null
  flightlog_pilot_id: number
  created_at: string
}

// Mirrors use-own-flightlog-pilot-id.ts's shape: a client-side effect keyed on userId, folding a
// query error into a distinct 'error' kind rather than silently collapsing a real status into
// "none" — a returning user who is actually 'pending' or 'verified' must never see this collapse
// into "no verification in flight", or re-triggering could stomp a live one (or re-send an email
// when a code is already outstanding).
//
// Queries the table directly rather than through a lib/profiles/*.ts helper, unlike
// use-own-flightlog-pilot-id.ts (which wraps getFlightlogPilotIds): this table has no other
// reader anywhere in the app yet, so there's nothing else that would share a lib function with
// it. Columns are named explicitly, never select('*') — otp_code_hash is excluded from the
// client's own column-level SELECT grant (see 20260813000000_create_profile_verifications.sql's
// own doc comment on why), so a bare select('*') fails outright with a column-privilege error.
//
// `refreshKey` isn't part of use-own-flightlog-pilot-id.ts's own signature — that hook never
// needs to refetch after its own writes, because PilotIdForm's useActionState re-renders
// independently of it. This hook's read has no such luck: starting verification
// (startPilotVerificationAction) happens via a plain client-side call with nothing bound to
// useActionState to force a re-render off (see pilot-verification.tsx's own doc comment) — the
// caller bumps refreshKey after that call settles so this effect re-runs and picks up the
// newly-issued (or newly-reset) row. Optional and defaulted to 0 so every other call site, and
// this hook's own "no refresh" tests, can ignore it entirely.
export function useOwnPilotVerificationStatus(userId: string, refreshKey = 0): OwnPilotVerificationStatusState {
  const [state, setState] = useState<OwnPilotVerificationStatusState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    // Wrapped in Promise.resolve(): the Supabase query builder's own .then() returns a bare
    // PromiseLike, not a full Promise, so it has no .catch of its own to chain — Promise.resolve()
    // upgrades it to a real Promise first, the same way get-flightlog-pilot-ids.ts's plain
    // async/await implicitly does for its own await'ed call.
    Promise.resolve(
      supabase.from('profile_verifications').select('status, otp_expires_at, email, flightlog_pilot_id, created_at').eq('user_id', userId).maybeSingle(),
    )
      .then(({ data, error }: { data: VerificationRow | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (error) {
          console.error('[account] failed to load pilot verification status:', error)
          setState({ kind: 'error' })
          return
        }
        setState(stateFromRow(data))
      })
      .catch((error: unknown) => {
        // Unlike getFlightlogPilotIds, nothing upstream here has already logged this — this query
        // runs directly against the Supabase client, so any thrown failure (as opposed to a
        // resolved {error} shape, handled above) gets its first and only log right here.
        if (cancelled) return
        console.error('[account] unexpected failure loading pilot verification status:', error)
        setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId, refreshKey])

  return state
}

// No row at all IS the unverified state, mirroring the migration's own "no 'unverified' status
// value" convention (see 20260813000000_create_profile_verifications.sql's own doc comment). A
// 'pending' row missing its expiry or email (should never happen — issue_pilot_verification is
// the only writer of a 'pending' row, and it always sets both) falls back to 'none' rather than
// rendering a pending UI with nothing to show.
function stateFromRow(row: VerificationRow | null): OwnPilotVerificationStatusState {
  if (row == null) return { kind: 'none' }
  if (row.status === 'verified') return { kind: 'verified' }
  if (row.status === 'pending' && row.otp_expires_at != null && row.email != null) {
    return { kind: 'pending', otpExpiresAt: row.otp_expires_at, email: row.email }
  }
  return { kind: 'none' }
}
