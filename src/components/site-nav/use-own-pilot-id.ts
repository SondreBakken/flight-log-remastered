'use client'

import { useEffect, useState } from 'react'
import { fetchOwnPilotId } from './fetch-own-pilot-id'

export type OwnPilotIdState = { kind: 'loading' } | { kind: 'loaded'; pilotId: number | null } | { kind: 'error' }

// Read after mount, from a route handler, so the root layout this nav sits in stays prerendered.
// The route answers for the session's own user; userId only re-runs the lookup when the signed-in
// user changes. Only ever called once OwnFlightsNavItem has resolved to 'signed-in'.
export function useOwnPilotId(userId: string): OwnPilotIdState {
  const [state, setState] = useState<OwnPilotIdState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchOwnPilotId()
      .then((pilotId) => {
        if (!cancelled) setState({ kind: 'loaded', pilotId })
      })
      .catch((error: unknown) => {
        console.error('[site-nav] failed to load own flightlog pilot id:', error)
        if (!cancelled) setState({ kind: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}
