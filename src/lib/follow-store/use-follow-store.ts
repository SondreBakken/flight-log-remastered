'use client'

import { useSyncExternalStore } from 'react'
import {
  getHasHydrated,
  getServerHasHydrated,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  toggleFollow,
} from './storage'
import type { PilotId } from './follow-ids'

// hasHydrated is false for the render that must match the server (no localStorage there),
// then flips true once the real, browser-read value is available. Consumers use it to render
// a neutral/skeleton state instead of a value indistinguishable from "genuinely not followed".
export interface FollowedPilotIds {
  followedIds: ReadonlySet<PilotId>
  hasHydrated: boolean
}

export function useFollowedPilotIds(): FollowedPilotIds {
  const followedIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hasHydrated = useSyncExternalStore(subscribe, getHasHydrated, getServerHasHydrated)
  return { followedIds, hasHydrated }
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
