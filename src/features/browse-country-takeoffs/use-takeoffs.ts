'use client'

import { useEffect, useState } from 'react'
import { fetchTakeoffs, type FetchTakeoffsResult } from './fetch-takeoffs'

export type TakeoffsState = { status: 'loading' } | FetchTakeoffsResult

// countryId is fixed for the lifetime of this component in practice (the page that renders
// it is itself keyed off the same route param), so the initial 'loading' state above is the
// only "reset to loading" this needs — no setState-in-effect to synchronize a changed prop.
export function useTakeoffs(countryId: number): TakeoffsState {
  const [state, setState] = useState<TakeoffsState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchTakeoffs(countryId).then((result) => {
      if (!cancelled) setState(result)
    })

    return () => {
      cancelled = true
    }
  }, [countryId])

  return state
}
