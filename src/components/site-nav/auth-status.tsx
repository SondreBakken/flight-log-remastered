'use client'

import Link from 'next/link'
import { LogIn, LogOut, User } from 'lucide-react'
import { useSignedInUser } from '@/lib/auth/use-signed-in-user'
import { VerificationStamp } from '@/components/verification-stamp'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'
import { useIsOwnVerified } from './use-own-verification'

// Applied to the icon and email, never to the link: opacity on the <a> would also dim the stamp inside it.
const MUTED_CLASSES = 'opacity-70'

// SiteNav sits in the root layout: reading the session server-side here would put a per-request
// dynamic hole in every page under Cache Components, including the curated country pages
// check:clubs-prerender and check:takeoffs-prerender pin as fully prerendered (issue #40).
// useSignedInUser reads it client-side after mount instead.
export default function AuthStatus() {
  const state = useSignedInUser()

  if (state.kind === 'loading') return null

  if (state.kind === 'signed-out') {
    return (
      <Link className={NAV_ICON_ROW_CLASSES} href="/sign-in">
        <LogIn aria-hidden="true" size={14} />
        <span className={NAV_LABEL_CLASSES}>Sign in</span>
      </Link>
    )
  }

  return <SignedInStatus key={state.userId} email={state.email} userId={state.userId} />
}

// Split out from the branch above so useIsOwnVerified (which needs a userId) is only ever called
// once state has actually narrowed to 'signed-in' — hooks can't be called conditionally in the
// branch itself. Mirrors features/account/index.tsx's own SignedInAccountForm split exactly.
function SignedInStatus({ userId, email }: { userId: string; email: string }) {
  const isVerified = useIsOwnVerified(userId)

  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link className={NAV_ICON_ROW_CLASSES} href="/account">
        <User aria-hidden="true" className={MUTED_CLASSES} size={14} />
        <span className={`${NAV_LABEL_CLASSES} ${MUTED_CLASSES} sm:max-w-[16ch] sm:truncate`}>{email}</span>
        {isVerified && <VerificationStamp label="Verified pilot" size={16} />}
      </Link>
      <form action="/api/auth/sign-out" method="post">
        <button className={NAV_ICON_ROW_CLASSES} type="submit">
          <LogOut aria-hidden="true" size={14} />
          <span className={NAV_LABEL_CLASSES}>Sign out</span>
        </button>
      </form>
    </div>
  )
}
