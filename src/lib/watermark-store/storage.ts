// Same 'use client' rationale as follow-store/storage.ts: this module reads/writes
// window.localStorage, so it must never run on the server.
'use client'

import {
  advanceWatermark,
  parseStoredWatermarks,
  removeWatermark,
  serializeWatermarks,
  STORED_RAW_MAX_LENGTH,
  type Timestamp,
} from './watermark-ids'
import { createCachedStore } from '@/lib/local-store/create-cached-store'
import type { PilotId } from '@/lib/flightlog/types'

type Watermarks = ReadonlyMap<PilotId, Timestamp>

// Unlike follow-store, nothing here is read reactively — no useSyncExternalStore, no
// subscribe/notify surface (getWatermark/recordSeen/clearWatermark below are plain function
// calls; see getWatermark's own doc comment for why). That is why this store and seen-trip-store
// share createCachedStore while follow-store does not: the shared adapter is the caching and
// persistence half only, and follow-store's reactive layer has no counterpart here to fold in.
const store = createCachedStore<Watermarks>({
  storageKey: 'flight-log:track-watermarks',
  empty: new Map(),
  parse: (raw) => {
    const result = parseStoredWatermarks(raw)
    return result.ok ? { ok: true, value: result.watermarks } : { ok: false }
  },
  serialize: serializeWatermarks,
  equal: watermarksEqual,
  maxRawLength: STORED_RAW_MAX_LENGTH,
  describeOversized: (watermarks, limit) =>
    `watermark-store: ${watermarks.size} pilot watermarks serialize past the ${limit}-char storage limit; not persisting.`,
})

function watermarksEqual(a: Watermarks, b: Watermarks): boolean {
  if (a.size !== b.size) return false
  for (const [pilotId, ts] of a) if (b.get(pilotId) !== ts) return false
  return true
}

// Plain read, not a hook: the feed reads each pilot's watermark once per pilot the instant
// that pilot's own fetch settles (see use-flight-feed.ts), specifically so it can be captured
// BEFORE recordSeen (below) advances it for the same load — a reactive subscription would
// blur that ordering, and nothing in this app needs a component to re-render when a watermark
// changes (unlike follow-store's followedIds, which drive the UI directly).
export function getWatermark(pilotId: PilotId): Timestamp | null {
  return store.current().get(pilotId) ?? null
}

// The only write path that moves a watermark forward. Called once per load, for each pilot
// whose SHOWN entries advanced their watermark — see use-flight-feed.ts and feed.ts's
// shownTrackedTsByPilot. advanceWatermark itself guards against ever moving backward, so
// calling this with a stale candidateTs is always safe, just a no-op.
export function recordSeen(pilotId: PilotId, candidateTs: Timestamp): void {
  store.commit(advanceWatermark(store.current(), pilotId, candidateTs))
}

// The explicit, deliberate call unfollowing a pilot must make (see
// follow-store/use-follow-store.ts's useFollowPilot): without it, refollowing that pilot later
// would compare their whole subsequent history against a stale watermark from before the
// unfollow, instead of showing it all as new again.
export function clearWatermark(pilotId: PilotId): void {
  store.commit(removeWatermark(store.current(), pilotId))
}
