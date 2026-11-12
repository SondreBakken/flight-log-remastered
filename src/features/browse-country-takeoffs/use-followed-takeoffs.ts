'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchFollowedTakeoffs } from './fetch-followed-takeoffs'

// Only `signed-in` is a known follow state; every other kind is a reason a row has none to show.
export type FollowedTakeoffsState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'signed-in'; followedTakeoffIds: ReadonlySet<number> }

export type FollowedTakeoffs = {
  state: FollowedTakeoffsState
  markFollowed: (takeoffId: number, followed: boolean) => void
}

// One request per mount, for every row. Takeoff ids are numbered per country, so only the
// entries for this countryId go into the set.
export function useFollowedTakeoffs(countryId: number): FollowedTakeoffs {
  const [state, setState] = useState<FollowedTakeoffsState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchFollowedTakeoffs().then(
      (result) => {
        if (cancelled) return
        if (result.kind === 'signed-out') {
          setState({ kind: 'signed-out' })
          return
        }
        const followedTakeoffIds = new Set(
          result.takeoffs.filter((takeoff) => takeoff.countryId === countryId).map((takeoff) => takeoff.takeoffId),
        )
        setState({ kind: 'signed-in', followedTakeoffIds })
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [countryId])

  // Keeps the shared set in step with a successful row action, so a row that remounts (name
  // filter, MAX_RENDERED_RESULTS cut) seeds its button from the new state, not the fetched one.
  const markFollowed = useCallback((takeoffId: number, followed: boolean) => {
    setState((current) => {
      if (current.kind !== 'signed-in') return current
      const followedTakeoffIds = new Set(current.followedTakeoffIds)
      if (followed) followedTakeoffIds.add(takeoffId)
      else followedTakeoffIds.delete(takeoffId)
      return { kind: 'signed-in', followedTakeoffIds }
    })
  }, [])

  return { state, markFollowed }
}
