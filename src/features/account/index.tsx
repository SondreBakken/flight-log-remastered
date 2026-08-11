'use client'

import Link from 'next/link'
import { useSignedInUser } from './use-signed-in-user'
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

  return <AccountForm />
}
