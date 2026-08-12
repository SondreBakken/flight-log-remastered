'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'

export type OwnFlightlogPilotIdState =
  | { kind: 'loading' }
  | { kind: 'loaded'; pilotId: number | null }
  | { kind: 'error' }

// Prefills pilot-id-form.tsx with the signed-in user's already-linked pilot id, mirroring
// use-own-display-name.ts's own shape and reasoning exactly — including reusing
// get-flightlog-pilot-ids.ts's read helper with a single-element id list rather than a one-off
// single-user query. Only ever called with a userId once use-signed-in-user.ts has already
// resolved to 'signed-in' (see index.tsx).
//
// getFlightlogPilotIds can throw a ProfilesQueryError on an unexpected failure (#163, same bug
// class as #160's fix to getDisplayNames) rather than resolving to an empty Map. Unlike
// account-activity/index.tsx's server-side caller, this is a client-side effect with nothing
// upstream to catch a rejected promise — left unhandled, it would surface as an unhandled promise
// rejection in the browser instead of any visible state. Caught here and folded into a distinct
// 'error' kind rather than a rethrow, same as use-own-display-name.ts's own 'error' kind: a
// returning user who already has a pilot id linked must never see this collapse silently into
// "no pilot linked", or a resubmit could wipe their real one.
export function useOwnFlightlogPilotId(userId: string): OwnFlightlogPilotIdState {
  const [state, setState] = useState<OwnFlightlogPilotIdState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const supabase = createClient()
    getFlightlogPilotIds(supabase, [userId])
      .then((pilotIds) => {
        if (!cancelled) setState({ kind: 'loaded', pilotId: pilotIds.get(userId) ?? null })
      })
      .catch(() => {
        // getFlightlogPilotIds (get-flightlog-pilot-ids.ts) already logs the underlying error at
        // the point of failure — logging it again here would just duplicate that entry for the
        // same cause.
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
