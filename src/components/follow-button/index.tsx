'use client'

import { getFollowButtonPresentation, type FollowButtonVariant } from './presentation'
import { useFollowPilot } from '@/lib/follow-store/use-follow-store'
import type { PilotId } from '@/lib/follow-store/follow-ids'

type FollowButtonProps = {
  pilotId: PilotId
  variant: FollowButtonVariant
}

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
