'use client'

import Link from 'next/link'
import { useSignedInUser } from './use-signed-in-user'
import { useOwnDisplayName } from './use-own-display-name'
import { useOwnFlightlogPilotId } from './use-own-flightlog-pilot-id'
import { AccountForm } from './account-form'
import { PilotIdForm } from './pilot-id-form'

// Signed-out visitor sees a sign-in prompt instead of the form — same three-state pattern as
// comment-on-flight/comment-composer.tsx (see its own doc comment): the auth state has to be
// read client-side, and this app deliberately has no server-side redirect-if-signed-out
// convention (see app/sign-in/page.tsx's own doc comment on staying static under Cache
// Components), so account/page.tsx stays a plain static shell and this client component handles
// the gating.
export default function AccountSettings() {
  const authState = useSignedInUser()

  if (authState.kind === 'loading') return null

  if (authState.kind === 'signed-out') {
    return (
      <p className="text-sm opacity-70">
        <Link className="underline underline-offset-2" href="/sign-in">
          Sign in
        </Link>{' '}
        to set a display name.
      </p>
    )
  }

  return <SignedInAccountForm userId={authState.userId} />
}

// Split out from the branch above so useOwnDisplayName/useOwnFlightlogPilotId (which need a
// userId) are only ever called once authState has actually narrowed to 'signed-in' — hooks
// can't be called conditionally in the branch itself.
//
// PilotIdForm renders as a sibling to AccountForm, not a merged form (see PilotIdForm's own doc
// comment): the two settings have independent failure modes and each binds its own
// useActionState.
function SignedInAccountForm({ userId }: { userId: string }) {
  const ownDisplayName = useOwnDisplayName(userId)
  const ownFlightlogPilotId = useOwnFlightlogPilotId(userId)
  return (
    <div className="flex flex-col gap-6">
      <AccountForm
        displayNameLoadFailed={ownDisplayName.kind === 'error'}
        initialDisplayName={ownDisplayName.kind === 'loaded' ? ownDisplayName.displayName : undefined}
      />
      <PilotIdForm initialPilotId={ownFlightlogPilotId.kind === 'loaded' ? ownFlightlogPilotId.pilotId : undefined} />
    </div>
  )
}
