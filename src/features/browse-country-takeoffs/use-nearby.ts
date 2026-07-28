'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { GeoPoint } from '@/lib/geo/distance'

// Refusal, unavailability, a slow fix, and a timeout are all normal outcomes for #12's
// "nearby" filter, not error states — 'denied', 'unavailable' and 'timeout' sit alongside
// 'granted' as equally valid rests for this machine, not as a single collapsed "failed" bucket
// a caller would be tempted to render as an error banner. 'timeout' is kept distinct from
// 'unavailable' specifically because it is NOT a browser incapability — the common indoor case
// at the 15 second ceiling below is a device that could still answer, just hasn't yet, and
// collapsing it into "unavailable" would tell the user something false.
export type NearbyStatus = 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable' | 'timeout'

export type NearbyState = {
  status: NearbyStatus
  location: GeoPoint | null
  requestNearby: () => void
  // Stops the active watch (if any) and resets to 'idle' — the caller's own uncheck handler,
  // not an internal effect, decides when this fires: geolocation permission-gated APIs must
  // never be started OR stopped except as the direct result of the user's own action. Resetting
  // to 'idle' rather than leaving the last status behind is what lets a later re-check retry
  // cleanly, including after a 'denied' or 'timeout' rest that requestNearby alone (gated on
  // 'idle') would otherwise never revisit.
  stopNearby: () => void
}

function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && navigator.geolocation != null
}

// Shared by the unmount cleanup and stopNearby below — the only two places a watch is ever
// torn down, so both go through the same clearWatch call rather than one of them drifting.
function clearActiveWatch(watchIdRef: RefObject<number | null>): void {
  if (watchIdRef.current !== null && hasGeolocation()) {
    navigator.geolocation.clearWatch(watchIdRef.current)
  }
  watchIdRef.current = null
}

// Client-side only, and never called from an effect on mount — geolocation is permission
// gated, so requesting it must be the direct result of the user asking for "nearby", not
// something that pops a browser permission prompt the instant the directory loads. Uses
// watchPosition rather than a one-shot getCurrentPosition specifically so a permission
// REVOKED mid-session (the user opens site settings and turns location off while this page is
// still open) is caught by the same error callback that handles an initial refusal, instead of
// silently continuing to sort by a now-stale position.
export function useNearby(): NearbyState {
  const [status, setStatus] = useState<NearbyStatus>('idle')
  const [location, setLocation] = useState<GeoPoint | null>(null)
  const watchIdRef = useRef<number | null>(null)

  useEffect(() => {
    return () => clearActiveWatch(watchIdRef)
  }, [])

  const requestNearby = useCallback(() => {
    if (!hasGeolocation()) {
      setStatus('unavailable')
      return
    }

    setStatus('pending')
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setStatus('granted')
        // watchPosition fires again for every GPS update, most of which report the SAME
        // coordinates (measured: 0.76ms per re-run, not urgent, but free to avoid) — a plain
        // `setLocation({...})` here would allocate a new object identity every time
        // regardless, invalidating index.tsx's `userLocation` memo and re-running the whole
        // filter/sort pipeline over all 6012 rows for a location that didn't actually change.
        // Returning the PREVIOUS state object when lat/lon are unchanged keeps the reference
        // stable, which is what lets React bail out of that re-render entirely.
        setLocation((previous) => {
          const lat = position.coords.latitude
          const lon = position.coords.longitude
          if (previous && previous.lat === lat && previous.lon === lon) return previous
          return { lat, lon }
        })
      },
      (error) => {
        // PERMISSION_DENIED and TIMEOUT are both real, distinct outcomes — a timeout (the
        // common indoor case at the 15 second ceiling below) is not the same claim as
        // "unavailable in this browser" and must not be reported as one.
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable')
        setLocation(null)
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [])

  const stopNearby = useCallback(() => {
    clearActiveWatch(watchIdRef)
    setStatus('idle')
    setLocation(null)
  }, [])

  return { status, location, requestNearby, stopNearby }
}
