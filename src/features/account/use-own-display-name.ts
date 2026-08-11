'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getDisplayNames } from '@/lib/profiles/get-display-names'

export type OwnDisplayNameState = { kind: 'loading' } | { kind: 'loaded'; displayName: string | null }

// Prefills account-form.tsx with the signed-in user's existing display name: without this, a
// returning user who already set one sees a blank input, just the placeholder, every time they
// open /account. Reuses get-display-names.ts's existing read helper with a single-element id
// list rather than adding a one-off single-user query — same injected-SupabaseClient
// testability convention as the rest of this feature. Only ever called with a userId once
// use-signed-in-user.ts has already resolved to 'signed-in' (see index.tsx).
export function useOwnDisplayName(userId: string): OwnDisplayNameState {
  const [state, setState] = useState<OwnDisplayNameState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getDisplayNames(supabase, [userId]).then((names) => {
      if (!cancelled) setState({ kind: 'loaded', displayName: names.get(userId) ?? null })
    })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
