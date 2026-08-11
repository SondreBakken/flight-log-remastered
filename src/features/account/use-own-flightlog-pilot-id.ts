'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'

export type OwnFlightlogPilotIdState = { kind: 'loading' } | { kind: 'loaded'; pilotId: number | null }

// Prefills pilot-id-form.tsx with the signed-in user's already-linked pilot id, mirroring
// use-own-display-name.ts's own shape and reasoning exactly — including reusing
// get-flightlog-pilot-ids.ts's read helper with a single-element id list rather than a one-off
// single-user query. Only ever called with a userId once use-signed-in-user.ts has already
// resolved to 'signed-in' (see index.tsx).
export function useOwnFlightlogPilotId(userId: string): OwnFlightlogPilotIdState {
  const [state, setState] = useState<OwnFlightlogPilotIdState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getFlightlogPilotIds(supabase, [userId]).then((pilotIds) => {
      if (!cancelled) setState({ kind: 'loaded', pilotId: pilotIds.get(userId) ?? null })
    })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
