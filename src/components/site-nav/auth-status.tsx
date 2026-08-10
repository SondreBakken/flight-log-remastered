'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
    const supabase = createClient()

    supabase.auth.getUser().then(({ data: { user } }) => {
      setState(toAuthState(user?.email))
    })

    // Keeps this in sync with sign-in completing in the tab the magic link opened and with
    // the sign-out route handler's redirect — both change the session cookie without this
    // component ever calling signInWithOtp/signOut itself.
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
