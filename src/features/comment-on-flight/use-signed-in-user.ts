'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getSupabaseEnv } from '@/lib/supabase/env'

export type SignedInUserState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; userId: string }

// Mirrors components/site-nav/auth-status.tsx's own subscription pattern (see its doc comment
// for why this reads client-side, after mount, rather than as a server-side cookies() read):
// driven entirely by onAuthStateChange, which fires once on mount with whatever session cookie
// exists, so a second getUser() call would be both redundant and racy. Kept as its own hook
// rather than reused from AuthStatus because the two consumers want different shapes back
// (AuthStatus needs the email to display, callers here only need "is anyone signed in").
export function useSignedInUser(): SignedInUserState {
  const [state, setState] = useState<SignedInUserState>({ kind: 'loading' })

  useEffect(() => {
    // Supabase not provisioned in this environment — stay in 'loading' (renders nothing)
    // rather than calling createClient(), which would throw. See env.ts's doc comment on
    // getSupabaseEnv vs requireSupabaseEnv.
    if (!getSupabaseEnv()) return

    const supabase = createClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session?.user ? { kind: 'signed-in', userId: session.user.id } : { kind: 'signed-out' })
    })

    return () => subscription.unsubscribe()
  }, [])

  return state
}
