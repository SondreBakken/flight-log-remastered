'use client'

import { getFollowButtonPresentation, type FollowButtonVariant } from './presentation'
import { useFollowPilot } from '@/lib/follow-store/use-follow-store'
import type { PilotId } from '@/lib/follow-store/follow-ids'
import { clearWatermark } from '@/lib/watermark-store/storage'

type FollowButtonProps = {
  pilotId: PilotId
  variant: FollowButtonVariant
}

export function FollowButton({ pilotId, variant }: FollowButtonProps) {
  const { isFollowed, hasHydrated, toggle } = useFollowPilot(pilotId)
  const presentation = getFollowButtonPresentation({ isFollowed, hasHydrated, variant })

  // This is the ONE place a pilot is ever unfollowed through the UI, so it is also the one
  // explicit call site for dropping their watermark (issue #5) — deliberately not folded
  // into follow-store itself, which knows nothing about watermarks (see watermark-store's
  // own module doc). Skipping this would let a later refollow compare that pilot's whole
  // subsequent history against a stale pre-unfollow watermark instead of showing it all as
  // new again, which is the honest behaviour for "I stopped, then started, following them".
  function handleToggle(): void {
    if (isFollowed) clearWatermark(pilotId)
    toggle()
  }

  return (
    <button
      aria-pressed={presentation.ariaPressed}
      className={presentation.className}
      disabled={presentation.disabled}
      onClick={handleToggle}
      type="button"
    >
      {presentation.label}
    </button>
  )
}
