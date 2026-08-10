'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { clearWatermark } from '@/lib/watermark-store/storage'
import { clearSeenTripIds } from '@/lib/seen-trip-store/storage'
import { FOLLOW_BUTTON_SIZE_CLASSES, getFollowButtonPresentation, type FollowButtonVariant } from './presentation'
import { followPilotAction, unfollowPilotAction } from './actions'
import type { PilotId } from '@/lib/flightlog/types'

type FollowButtonProps = {
  pilotId: PilotId
  variant: FollowButtonVariant
  // Both resolved once server-side per page (see resolve-viewer-follow-state.ts), not read here
  // via a client-side auth subscription or Supabase query — this component's only own state is
  // the optimistic flip below, seeded from isFollowed.
  isFollowed: boolean
  isSignedIn: boolean
}

// Dropping a pilot's watermark and seen-trip entry on unfollow (issue #5, extended by #62) used
// to be composed inside useFollowPilot's toggle (src/lib/follow-store/use-follow-store.ts,
// removed by #115) — that seam knew both isFollowed and pilotId, so every follow-toggling
// consumer got the rule for free. This is now the only follow-toggling consumer, so the same
// composition lives here instead: both localStorage stores are unrelated to #115's server-backed
// follow list and stay untouched by it, but unfollowing must still clear them, same as before.
export function FollowButton({ pilotId, variant, isFollowed, isSignedIn }: FollowButtonProps) {
  const [followed, setFollowed] = useState(isFollowed)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!isSignedIn) {
    return (
      <Link
        className={`${FOLLOW_BUTTON_SIZE_CLASSES[variant]} inline-block border-transparent underline underline-offset-2 opacity-70`}
        href="/sign-in"
      >
        Sign in to follow
      </Link>
    )
  }

  function handleClick() {
    setError(null)
    const nextFollowed = !followed

    startTransition(async () => {
      const result = nextFollowed ? await followPilotAction(pilotId) : await unfollowPilotAction(pilotId)
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      // Only after a confirmed unfollow, not optimistically before it — clearing these first and
      // then finding out the server action failed would drop the watermark/seen-trip entry for a
      // pilot who, server-side, is still followed.
      if (!nextFollowed) {
        clearWatermark(pilotId)
        clearSeenTripIds(pilotId)
      }
      setFollowed(nextFollowed)
    })
  }

  const presentation = getFollowButtonPresentation({ isFollowed: followed, variant })

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        aria-pressed={presentation.ariaPressed}
        className={`${presentation.className} disabled:opacity-50`}
        disabled={isPending}
        onClick={handleClick}
        type="button"
      >
        {presentation.label}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
