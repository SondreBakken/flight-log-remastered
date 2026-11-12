import { deriveUpstreamStatus, WINDOW_SIZE, type UpstreamEntry, type UpstreamStatus } from './upstream-status'

// CAVEAT: this window is per process. Each Railway instance keeps its own, it resets on deploy
// and starts 'unknown'. `use cache` hits make no upstream request and add nothing, so a quiet
// site reads 'unknown', not 'up'. Several replicas would each show their own state.
//
// Kept under a Symbol.for key on globalThis because under `next dev` the route handler and the
// code that records can be bundled as separate module instances; module-level state would
// give each its own window.
const STORE_KEY = Symbol.for('flight-log-remastered.upstream-status-window')

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: UpstreamEntry[] }

function upstreamWindow(): UpstreamEntry[] {
  const holder = globalThis as GlobalWithStore
  holder[STORE_KEY] ??= []
  return holder[STORE_KEY]
}

export function recordUpstreamRequest(entry: UpstreamEntry): void {
  const entries = upstreamWindow()
  entries.push(entry)
  if (entries.length > WINDOW_SIZE) entries.splice(0, entries.length - WINDOW_SIZE)
}

export function readUpstreamStatus(nowMs: number): UpstreamStatus {
  return deriveUpstreamStatus(upstreamWindow(), nowMs)
}
