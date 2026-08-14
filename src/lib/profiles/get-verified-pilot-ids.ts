import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'
import type { PilotId } from '@/lib/flightlog/types'

type VerificationRow = { flightlog_pilot_id: PilotId; status: string }

// Business logic: which of a set of flightlog.org pilot ids currently have a 'verified'
// profile_verifications row, against an injected Supabase client (same testability convention,
// and same array-in/Set-out shape, as getFollowedPilotIds — a missing id is simply absent from
// the returned Set, callers read that identically to an explicit unverified row).
//
// Deliberately keyed on flightlog_pilot_id, not user_id, unlike use-own-pilot-verification-status.ts
// (built for #177's account-settings page, which only ever needs "is the signed-in viewer
// themselves verified"). account-activity (#188) asks a different question — "is THIS pilot-id
// link verified" — for pilot ids it renders, not for the viewer's own identity. In practice the
// two answers coincide today: this table's RLS policy (see
// 20260813000000_create_profile_verifications.sql's own doc comment) is `auth.uid() = user_id`,
// owner-only in every direction, so the querying session can only ever see its own row regardless
// of which column this filters by. Filtering by pilot id anyway keeps this helper's contract
// honest about what it answers, and is what actually lets a future caller batch several displayed
// pilot ids in one round trip the way getFlightlogPilotIds/getDisplayNames already do for their
// own tables — RLS, not this query shape, is what limits today's callers to one visible row.
//
// No special-cased soft-degrade for a missing table (unlike get-flightlog-pilot-ids.ts/
// get-display-names.ts's own 42703 carve-out for a missing COLUMN on profiles, which always
// exists) — mirrors use-own-pilot-verification-status.ts's own choice not to special-case this
// same table's absence: any query failure throws.
export async function getVerifiedPilotIds(supabase: SupabaseClient, pilotIds: PilotId[]): Promise<Set<PilotId>> {
  if (pilotIds.length === 0) return new Set()

  const { data, error } = await supabase
    .from('profile_verifications')
    .select('flightlog_pilot_id, status')
    .in('flightlog_pilot_id', pilotIds)

  if (error) {
    console.error('[profiles] failed to load pilot verification statuses:', error)
    throw new ProfilesQueryError(
      `Failed to load pilot verification statuses for ${pilotIds.length} pilot ${pilotIds.length === 1 ? 'id' : 'ids'}: ${error.message}`,
      { cause: error },
    )
  }

  return new Set(
    (data as VerificationRow[]).filter((row) => row.status === 'verified').map((row) => row.flightlog_pilot_id),
  )
}
