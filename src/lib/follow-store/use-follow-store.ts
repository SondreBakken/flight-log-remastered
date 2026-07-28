'use client'

import { useSyncExternalStore } from 'react'
import { getServerSnapshot, getSnapshot, subscribe, toggleFollow, type FollowStoreSnapshot } from './storage'
import { clearWatermark } from '@/lib/watermark-store/storage'
import type { PilotId } from './follow-ids'

export function useFollowedPilotIds(): FollowStoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useFollowPilot(pilotId: PilotId): {
  isFollowed: boolean
  hasHydrated: boolean
  toggle: () => void
} {
  const { followedIds, hasHydrated } = useFollowedPilotIds()
  const isFollowed = followedIds.has(pilotId)
  return {
    isFollowed,
    hasHydrated,
    // The explicit call unfollowing a pilot must make (issue #5), composed here rather than
    // in whichever UI component happens to render a follow control: this hook is already the
    // one seam that knows both `isFollowed` (only unfollowing clears — refollowing shows the
    // pilot's whole history as new again, but following an already-watched pilot must not
    // touch their watermark) and `pilotId`, so every caller gets the rule for free instead of
    // each one having to remember it. follow-store/storage.ts itself stays watermark-free —
    // it does not know watermark-store exists.
    toggle: () => {
      if (isFollowed) clearWatermark(pilotId)
      toggleFollow(pilotId)
    },
  }
}
