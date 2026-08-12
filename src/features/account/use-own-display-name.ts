'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getDisplayNames } from '@/lib/profiles/get-display-names'

export type OwnDisplayNameState = { kind: 'loading' } | { kind: 'loaded'; displayName: string | null } | { kind: 'error' }

// Prefills account-form.tsx with the signed-in user's existing display name: without this, a
// returning user who already set one sees a blank input, just the placeholder, every time they
// open /account. Reuses get-display-names.ts's existing read helper with a single-element id
// list rather than adding a one-off single-user query — same injected-SupabaseClient
// testability convention as the rest of this feature. Only ever called with a userId once
// use-signed-in-user.ts has already resolved to 'signed-in' (see index.tsx).
//
// getDisplayNames can throw a ProfilesQueryError on an unexpected failure (#160) rather than
// resolving to an empty Map. Unlike attachDisplayNames's server-side callers, this is a
// client-side effect with nothing upstream to catch a rejected promise — left unhandled, it
// would surface as an unhandled promise rejection in the browser instead of any visible state.
// Caught here and folded into a new 'error' kind rather than a distinct error message: index.tsx
// already treats every non-'loaded' state as "no prefill available" (`ownDisplayName.kind ===
// 'loaded' ? ... : undefined`), the same blank-input fallback a still-loading fetch gets, so an
// error just leaves the field blank instead of failing to render the form at all. The user can
// still type and save a new name; they only lose the prefill of their existing one.
export function useOwnDisplayName(userId: string): OwnDisplayNameState {
  const [state, setState] = useState<OwnDisplayNameState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getDisplayNames(supabase, [userId])
      .then((names) => {
        if (!cancelled) setState({ kind: 'loaded', displayName: names.get(userId) ?? null })
      })
      .catch((error: unknown) => {
        console.error('[profiles] failed to load own display name:', error)
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
