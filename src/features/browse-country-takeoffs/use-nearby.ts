'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoPoint } from '@/lib/geo/distance'

// Refusal, unavailability, and a slow fix are all normal outcomes for #12's "nearby" filter,
// not error states — 'denied' and 'unavailable' sit alongside 'granted' as equally valid rests
// for this machine, not as a single collapsed "failed" bucket a caller would be tempted to
// render as an error banner.
export type NearbyStatus = 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable'

export type NearbyState = {
  status: NearbyStatus
  location: GeoPoint | null
  requestNearby: () => void
}

function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && navigator.geolocation != null
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
    return () => {
      if (watchIdRef.current !== null && hasGeolocation()) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
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
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')
        setLocation(null)
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [])

  return { status, location, requestNearby }
}
