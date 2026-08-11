'use client'

import Link from 'next/link'
import { useSignedInUser } from './use-signed-in-user'
import { useOwnDisplayName } from './use-own-display-name'
import { AccountForm } from './account-form'

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

// Split out from the branch above so useOwnDisplayName (which needs a userId) is only ever
// called once authState has actually narrowed to 'signed-in' — hooks can't be called
// conditionally in the branch itself.
function SignedInAccountForm({ userId }: { userId: string }) {
  const ownDisplayName = useOwnDisplayName(userId)
  return <AccountForm initialDisplayName={ownDisplayName.kind === 'loaded' ? ownDisplayName.displayName : undefined} />
}
