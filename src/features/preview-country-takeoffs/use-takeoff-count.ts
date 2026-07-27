'use client'

import { useEffect, useState } from 'react'
import { fetchTakeoffCount, type TakeoffCountResult } from './fetch-takeoff-count'

export type TakeoffCountState = { status: 'loading' } | TakeoffCountResult

// countryId is fixed for the lifetime of this component in practice (the page that renders
// it is itself keyed off the same route param), so the initial 'loading' state above is the
// only "reset to loading" this needs — no setState-in-effect to synchronize a changed prop.
export function useTakeoffCount(countryId: number): TakeoffCountState {
  const [state, setState] = useState<TakeoffCountState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchTakeoffCount(countryId).then((result) => {
      if (!cancelled) setState(result)
    })

    return () => {
      cancelled = true
    }
  }, [countryId])

  return state
}
