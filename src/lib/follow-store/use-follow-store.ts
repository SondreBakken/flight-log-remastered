'use client'

import { useSyncExternalStore } from 'react'
import { getServerSnapshot, getSnapshot, subscribe, toggleFollow } from './storage'
import type { PilotId } from './follow-ids'

export function useFollowedPilotIds(): ReadonlySet<PilotId> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useFollowPilot(pilotId: PilotId): { isFollowed: boolean; toggle: () => void } {
  const followedIds = useFollowedPilotIds()
  return {
    isFollowed: followedIds.has(pilotId),
    toggle: () => toggleFollow(pilotId),
  }
}
