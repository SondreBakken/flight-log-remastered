import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getFlightlogPilotIds } from './get-flightlog-pilot-ids'
import { ProfilesQueryError } from './profiles-query-error'

export type CertificateProgressState = {
  isOwner: boolean
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

const DEFAULT_STATE: CertificateProgressState = { isOwner: false, level: null, levelSetAt: null, checklist: {} }

// Resolved once per page render, same "resolve identity server-side once, pass booleans down"
// shape as resolveFollowButtonState. Renders as the default (unowned, undeclared) state rather
// than crashing when Supabase isn't provisioned, or when a profiles query genuinely fails — this
// card is additive UI, not load-bearing for the pilot page it sits on. Only ProfilesQueryError is
// caught (mirrors resolveViewerFollowState's own FollowsQueryError-only catch); any other throw
// (e.g. a mapping bug unrelated to the query itself) propagates.
export async function resolveCertificateProgressState(pilotId: PilotId): Promise<CertificateProgressState> {
  if (!getSupabaseEnv()) return DEFAULT_STATE

  const supabase = await createClient()

  try {
    const progress = await getCertificateProgressByPilotId(supabase, pilotId)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    let isOwner = false
    if (user) {
      const pilotIds = await getFlightlogPilotIds(supabase, [user.id])
      isOwner = pilotIds.get(user.id) === pilotId
    }

    return {
      isOwner,
      level: progress?.level ?? null,
      levelSetAt: progress?.levelSetAt ?? null,
      checklist: progress?.checklist ?? {},
    }
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    console.error('[profiles] failed to resolve certificate progress state:', error)
    return DEFAULT_STATE
  }
}
