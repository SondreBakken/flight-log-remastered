'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { LogIn, LogOut, PlaneTakeoff, TriangleAlert, User, type LucideIcon } from 'lucide-react'
import { useSignedInUser } from '@/lib/auth/use-signed-in-user'
import { VerificationStamp } from '@/components/verification-stamp'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'
import { useOwnPilotId } from './use-own-pilot-id'
import { useIsOwnVerified } from './use-own-verification'

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

// Split out from the branch above so useOwnPilotId and useIsOwnVerified (which need a userId) are only ever called
// once state has actually narrowed to 'signed-in' — hooks can't be called conditionally in the
// branch itself. Mirrors features/account/index.tsx's own SignedInAccountForm split exactly.
function SignedInStatus({ userId, email }: { userId: string; email: string }) {
  const ownPilotId = useOwnPilotId(userId)
  const isVerified = useIsOwnVerified(userId)

  return (
    <div className="flex shrink-0 items-center gap-3">
      <OwnFlightsLink ownPilotId={ownPilotId} />
      <NavIconLink href="/account" icon={User} muted>
        <span className={`${NAV_LABEL_CLASSES} sm:max-w-[16ch] sm:truncate`}>{email}</span>
        {isVerified && <VerificationStamp label="Verified pilot" size={16} />}
      </NavIconLink>
      <form action="/api/auth/sign-out" method="post">
        <button className={NAV_ICON_ROW_CLASSES} type="submit">
          <LogOut aria-hidden="true" size={14} />
          <span className={NAV_LABEL_CLASSES}>Sign out</span>
        </button>
      </form>
    </div>
  )
}

// A failed pilot-id lookup must still reach the user rather than degrading identically to "no
// pilot linked" (silently omitting both looks the same to a reader of the rendered nav) — see
// use-own-pilot-id.ts's own 'error' state, which this is the only caller of.
function OwnFlightsLink({ ownPilotId }: { ownPilotId: ReturnType<typeof useOwnPilotId> }) {
  if (ownPilotId.kind === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-500" title="Could not load your pilot id">
        <TriangleAlert aria-hidden="true" size={14} />
      </span>
    )
  }

  if (ownPilotId.kind !== 'loaded' || ownPilotId.pilotId == null) return null

  return (
    <NavIconLink href={`/pilots/${ownPilotId.pilotId}`} icon={PlaneTakeoff}>
      <span className={NAV_LABEL_CLASSES}>My flights</span>
    </NavIconLink>
  )
}

function NavIconLink({
  href,
  icon: Icon,
  muted,
  children,
}: {
  href: string
  icon: LucideIcon
  muted?: boolean
  children: ReactNode
}) {
  return (
    <Link className={muted ? `${NAV_ICON_ROW_CLASSES} opacity-70` : NAV_ICON_ROW_CLASSES} href={href}>
      <Icon aria-hidden="true" size={14} />
      {children}
    </Link>
  )
}
