import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

type ProfileRow = {
  user_id: string
  certificate_level: CertificateLevel | null
  certificate_level_set_at: string | null
  certificate_checklist: CertificateChecklist
}

export type CertificateProgressRow = {
  userId: string
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

// Reverse lookup: profiles is keyed by auth user_id, but the pilot page is keyed by flightlog.org
// pilot id. Unlike flightlog_pilot_id verification (owner-only RLS), profiles' own SELECT policy
// is public (`using (true)`), so this works for any viewer, signed in or not. flightlog_pilot_id
// carries no uniqueness constraint, so more than one profile could in principle self-declare the
// same pilot id — this reads the first match rather than treating that as an error, the same
// loose trust model flightlog_pilot_id linking already accepts elsewhere.
export async function getCertificateProgressByPilotId(supabase: SupabaseClient, pilotId: PilotId): Promise<CertificateProgressRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, certificate_level, certificate_level_set_at, certificate_checklist')
    .eq('flightlog_pilot_id', pilotId)

  if (error) {
    if (error.code === '42703') {
      console.error(
        '[profiles] a certificate progress column does not exist — apply migration 20260827000000_add_certificate_progress_to_profiles.sql',
        error,
      )
      return null
    }
    console.error('[profiles] failed to load certificate progress for pilot id:', error)
    throw new ProfilesQueryError(`Failed to load certificate progress for pilot id ${pilotId}: ${error.message}`, { cause: error })
  }

  const [row] = data as ProfileRow[]
  if (row === undefined) return null

  return {
    userId: row.user_id,
    level: row.certificate_level,
    levelSetAt: row.certificate_level_set_at,
    checklist: row.certificate_checklist,
  }
}
