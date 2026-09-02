'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

export type OwnPilotIdState = { kind: 'loading' } | { kind: 'loaded'; pilotId: number | null } | { kind: 'error' }

// Kept as its own copy rather than imported from features/account/use-own-flightlog-pilot-id.ts
// (which it otherwise mirrors exactly) — components/site-nav must not depend on a feature's
// internals, same independence use-signed-in-user.ts already documents across features.
// Only ever called with a userId once AuthStatus has resolved to 'signed-in'.
export function useOwnPilotId(userId: string): OwnPilotIdState {
  const [state, setState] = useState<OwnPilotIdState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getFlightlogPilotIds(supabase, [userId])
      .then((pilotIds) => {
        if (!cancelled) setState({ kind: 'loaded', pilotId: pilotIds.get(userId) ?? null })
      })
      .catch((error) => {
        if (!(error instanceof ProfilesQueryError)) console.error('[site-nav] unexpected failure loading own flightlog pilot id:', error)
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
