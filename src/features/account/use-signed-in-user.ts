'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getSupabaseEnv } from '@/lib/supabase/env'

export type SignedInUserState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; userId: string }

// Mirrors comment-on-flight/use-signed-in-user.ts's own pattern exactly (see its doc comment for
// the full reasoning: driven entirely by onAuthStateChange, no separate getUser() call). Kept as
// its own copy in this feature folder rather than imported across features — each feature stays
// independent of its siblings, same as comment-on-flight and follow-button already are of each
// other.
export function useSignedInUser(): SignedInUserState {
  const [state, setState] = useState<SignedInUserState>({ kind: 'loading' })

  useEffect(() => {
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
