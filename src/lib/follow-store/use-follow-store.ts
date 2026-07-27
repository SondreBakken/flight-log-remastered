'use client'

import { useSyncExternalStore } from 'react'
import { getServerSnapshot, getSnapshot, subscribe, toggleFollow, type FollowStoreSnapshot } from './storage'
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
  return {
    isFollowed: followedIds.has(pilotId),
    hasHydrated,
    toggle: () => toggleFollow(pilotId),
  }
}
