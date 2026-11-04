import { getDb } from '@/lib/db/client'
import { getCurrentUserId } from '@/lib/auth/current-user'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getProfile } from './get-profile'
import { ProfilesQueryError } from './profiles-query-error'

export type CertificateProgressState = {
  isOwner: boolean
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

const DEFAULT_STATE: CertificateProgressState = { isOwner: false, level: null, levelSetAt: null, checklist: {} }

// Resolved once per page render, like resolveFollowButtonState. The card is additive to the pilot
// page, so a failed profiles query renders the default (unowned, undeclared) state instead of
// breaking the page. Only ProfilesQueryError is caught; any other throw propagates.
//
// The session is read before the database is touched, so under Cache Components the caller is
// already dynamic by the time a query runs.
export async function resolveCertificateProgressState(pilotId: PilotId): Promise<CertificateProgressState> {
  const viewerUserId = await getCurrentUserId()

  try {
    const [progress, isOwner] = await Promise.all([
      getCertificateProgressByPilotId(getDb(), pilotId),
      isViewerLinkedToPilot(viewerUserId, pilotId),
    ])
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

async function isViewerLinkedToPilot(viewerUserId: string | null, pilotId: PilotId): Promise<boolean> {
  if (!viewerUserId) return false
  const viewerProfile = await getProfile(getDb(), viewerUserId)
  return viewerProfile.flightlogPilotId === pilotId
}
