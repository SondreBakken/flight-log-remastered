'use client'

import { getFollowButtonPresentation, type FollowButtonVariant } from './presentation'
import { useFollowPilot } from '@/lib/follow-store/use-follow-store'
import type { PilotId } from '@/lib/flightlog/types'

type FollowButtonProps = {
  pilotId: PilotId
  variant: FollowButtonVariant
}

// Dropping a pilot's watermark on unfollow (issue #5) is composed into useFollowPilot's
// `toggle` itself (see its own doc comment), not this component — that seam already knows
// both `isFollowed` and `pilotId`, so every follow-toggling consumer gets the rule for free
// rather than just this one button.
export function FollowButton({ pilotId, variant }: FollowButtonProps) {
  const { isFollowed, hasHydrated, toggle } = useFollowPilot(pilotId)
  const presentation = getFollowButtonPresentation({ isFollowed, hasHydrated, variant })

  return (
    <button
      aria-pressed={presentation.ariaPressed}
      className={presentation.className}
      disabled={presentation.disabled}
      onClick={toggle}
      type="button"
    >
      {presentation.label}
    </button>
  )
}
