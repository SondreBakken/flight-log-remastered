'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getSupabaseEnv } from '@/lib/supabase/env'

type AuthState = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'signed-in'; email: string }

function toAuthState(email: string | undefined): AuthState {
  return email ? { kind: 'signed-in', email } : { kind: 'signed-out' }
}

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
      setState(toAuthState(session?.user.email))
    })

    return () => subscription.unsubscribe()
  }, [])

  if (state.kind === 'loading') return null

  if (state.kind === 'signed-out') {
    return (
      <Link className="underline-offset-2 hover:underline" href="/sign-in">
        Sign in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="opacity-70">{state.email}</span>
      <form action="/api/auth/sign-out" method="post">
        <button className="underline-offset-2 hover:underline" type="submit">
          Sign out
        </button>
      </form>
    </div>
  )
}
