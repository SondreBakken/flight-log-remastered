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
// Caught here and folded into a distinct 'error' kind rather than a rethrow: account-form.tsx
// discriminates it from 'loading' (both leave the input's own value blank, but 'error' also shows
// an inline notice and disables the field — see that component's own doc comment) rather than
// treating it as just another flavor of "no prefill available yet". A returning user who already
// has a display name set must never see this collapse silently into "no name set", or a blank
// submit would wipe their real one.
export function useOwnDisplayName(userId: string): OwnDisplayNameState {
  const [state, setState] = useState<OwnDisplayNameState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getDisplayNames(supabase, [userId])
      .then((names) => {
        if (!cancelled) setState({ kind: 'loaded', displayName: names.get(userId) ?? null })
      })
      .catch(() => {
        // getDisplayNames (get-display-names.ts) already logs the underlying error at the point
        // of failure — logging it again here would just duplicate that entry for the same cause.
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
