'use client'

import { useState } from 'react'
import type { Profile } from '@/lib/profiles/get-profile'
import { useOwnPilotVerificationStatus } from './use-own-pilot-verification-status'
import { AccountForm } from './account-form'
import { PilotIdForm } from './pilot-id-form'
import { PilotVerification } from './pilot-verification'

export type OwnProfileState = { kind: 'loaded'; profile: Profile } | { kind: 'error' }

// PilotIdForm is a sibling of AccountForm, not a second field on it: the two settings fail
// independently and each binds its own useActionState. PilotVerification is a third sibling,
// rendered only once a pilot id is linked, since there is nothing to verify before that.
export function SignedInAccountSettings({ userId, ownProfile }: { userId: string; ownProfile: OwnProfileState }) {
  // Bumped whenever something outside useOwnPilotVerificationStatus may have changed the user's
  // verification: starting it, confirming a code, or relinking the pilot id (the
  // invalidate_verification_on_pilot_id_change trigger deletes the verification on that write).
  const [verificationRefreshKey, setVerificationRefreshKey] = useState(0)
  const refreshVerificationStatus = () => setVerificationRefreshKey((key) => key + 1)
  const ownVerificationStatus = useOwnPilotVerificationStatus(userId, verificationRefreshKey)

  const profile = ownProfile.kind === 'loaded' ? ownProfile.profile : undefined
  const profileLoadFailed = ownProfile.kind === 'error'

  return (
    <div className="flex flex-col gap-6">
      <AccountForm displayNameLoadFailed={profileLoadFailed} initialDisplayName={profile?.displayName} />
      <PilotIdForm
        initialPilotId={profile?.flightlogPilotId}
        onSaved={refreshVerificationStatus}
        pilotIdLoadFailed={profileLoadFailed}
      />
      {profile?.flightlogPilotId != null && (
        <PilotVerification onStatusChanged={refreshVerificationStatus} status={ownVerificationStatus} />
      )}
    </div>
  )
}
