'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { LogIn, LogOut, PlaneTakeoff, TriangleAlert, User, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { useOwnPilotId } from './use-own-pilot-id'

const NAV_ICON_ROW_CLASSES = 'flex items-center gap-1.5 underline-offset-2 hover:underline'

type AuthState = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'signed-in'; userId: string; email: string }

// This has to read the session client-side rather than as a Server Component reading cookies()
// server-side: SiteNav sits in the root layout, so a server-side session read here would make
// EVERY page under it carry a per-request dynamic hole under Cache Components — including the
// curated country pages check:clubs-prerender and check:takeoffs-prerender pin as resolved
// fully at build time (issue #40). Reading the session client-side, after mount, keeps the
// server-rendered shell of every page fully static; only this one corner of the page hydrates
// in with the real signed-in state a moment later.
export default function AuthStatus() {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  useEffect(() => {
    // Supabase not provisioned in this environment — stay in 'loading' (which renders
    // nothing) forever rather than calling createClient(), which would throw. See env.ts's
    // doc comment on getSupabaseEnv vs requireSupabaseEnv: this is exactly the kind of call
    // site that must treat "unconfigured" as a no-op, not an error, since it's mounted in the
    // root layout and would otherwise take down every page in the site.
    if (!getSupabaseEnv()) return

    const supabase = createClient()

    // Driven entirely by this subscription rather than also calling getUser() separately: the
    // subscription already fires once on mount with an `INITIAL_SESSION` event carrying
    // whatever session cookie exists, so a second, separate getUser() call is both redundant
    // and racy — its promise can resolve after a later SIGNED_OUT event and resurrect a
    // signed-in email.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session?.user.email ? { kind: 'signed-in', userId: session.user.id, email: session.user.email } : { kind: 'signed-out' })
    })

    return () => subscription.unsubscribe()
  }, [])

  if (state.kind === 'loading') return null

  if (state.kind === 'signed-out') {
    return (
      <Link className="flex items-center gap-1.5 underline-offset-2 hover:underline" href="/sign-in">
        <LogIn aria-hidden="true" size={14} />
        Sign in
      </Link>
    )
  }

  return <SignedInStatus email={state.email} userId={state.userId} />
}

// Split out from the branch above so useOwnPilotId (which needs a userId) is only ever called
// once state has actually narrowed to 'signed-in' — hooks can't be called conditionally in the
// branch itself. Mirrors features/account/index.tsx's own SignedInAccountForm split exactly.
function SignedInStatus({ userId, email }: { userId: string; email: string }) {
  const ownPilotId = useOwnPilotId(userId)

  return (
    <div className="flex items-center gap-3">
      <OwnFlightsLink ownPilotId={ownPilotId} />
      <NavIconLink href="/account" icon={User} muted>
        {email}
      </NavIconLink>
      <form action="/api/auth/sign-out" method="post">
        <button className={NAV_ICON_ROW_CLASSES} type="submit">
          <LogOut aria-hidden="true" size={14} />
          Sign out
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
      My flights
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
