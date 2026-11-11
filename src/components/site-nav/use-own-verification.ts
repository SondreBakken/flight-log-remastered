'use client'

import { useEffect, useState } from 'react'
import { subscribeOwnVerificationChanged } from '@/lib/profiles/own-verification-changed'
import { fetchOwnVerification } from './fetch-own-verification'

// Read after mount, from a route handler, so the root layout this nav sits in stays prerendered.
// True only for a confirmed 'verified': loading, a failed lookup, none and pending all read false,
// so the stamp never shows on a guess. Refetches when the account flows report a change.
export function useIsOwnVerified(userId: string): boolean {
  const [isVerified, setIsVerified] = useState(false)

  useEffect(() => {
    // Only the newest request may write: a slower, older answer would resurrect a stale status.
    let latestRequest = 0
    let isMounted = true

    const load = () => {
      const request = ++latestRequest
      fetchOwnVerification()
        .then((status) => {
          if (isMounted && request === latestRequest) setIsVerified(status === 'verified')
        })
        .catch((error: unknown) => {
          console.error('[site-nav] failed to load own verification:', error)
          if (isMounted && request === latestRequest) setIsVerified(false)
        })
    }

    load()
    const unsubscribe = subscribeOwnVerificationChanged(load)

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [userId])

  return isVerified
}
