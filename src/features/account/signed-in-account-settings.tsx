'use client'

import { useRouter } from 'next/navigation'
import type { Profile } from '@/lib/profiles/get-profile'
import { AccountForm } from './account-form'
import { PilotIdForm } from './pilot-id-form'
import { PilotVerification, type OwnPilotVerificationState } from './pilot-verification'

export type OwnProfileState = { kind: 'loaded'; profile: Profile } | { kind: 'error' }

type SignedInAccountSettingsProps = {
  ownProfile: OwnProfileState
  ownVerification: OwnPilotVerificationState
}

// PilotIdForm is a sibling of AccountForm, not a second field on it: the two settings fail
// independently and each binds its own useActionState. PilotVerification is a third sibling,
// rendered only once a pilot id is linked, since there is nothing to verify before that.
export function SignedInAccountSettings({ ownProfile, ownVerification }: SignedInAccountSettingsProps) {
  const router = useRouter()
  // The profile and verification are server-rendered props, so anything that may have changed
  // them re-renders the server component: starting verification, confirming a code, or relinking
  // the pilot id (the invalidate_verification_on_pilot_id_change trigger deletes the
  // verification on that write).
  const refreshAccountSettings = () => router.refresh()

  const profile = ownProfile.kind === 'loaded' ? ownProfile.profile : undefined
  const profileLoadFailed = ownProfile.kind === 'error'

  return (
    <div className="flex flex-col gap-6">
      <AccountForm displayNameLoadFailed={profileLoadFailed} initialDisplayName={profile?.displayName} />
      <PilotIdForm
        initialPilotId={profile?.flightlogPilotId}
        onSaved={refreshAccountSettings}
        pilotIdLoadFailed={profileLoadFailed}
        verification={ownVerification}
      />
      {profile?.flightlogPilotId != null && (
        <PilotVerification onStatusChanged={refreshAccountSettings} status={ownVerification} />
      )}
    </div>
  )
}
