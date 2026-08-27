import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateLevelInput = {
  userId: string
  level: CertificateLevel
}

export type UpdateCertificateLevelResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// certificate_level_set_at is stamped here, at write time, rather than by a database trigger —
// this is the one place that knows "the level actually changed just now" without a second round
// trip to compare against the previous value. Downgrading to an earlier level is allowed and
// still re-stamps the timestamp: the self-declared trust model here doesn't validate against
// flight history, so there's nothing to gate a downgrade on.
export async function updateCertificateLevel(supabase: SupabaseClient, input: UpdateCertificateLevelInput): Promise<UpdateCertificateLevelResult> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, certificate_level: input.level, certificate_level_set_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) {
    console.error('[profiles] failed to save certificate level:', error)
    return { kind: 'db-error', message: 'failed to save the certificate level' }
  }

  return { kind: 'saved' }
}
