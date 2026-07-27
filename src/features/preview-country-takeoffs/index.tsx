'use client'

import { useTakeoffCount, type TakeoffCountState } from './use-takeoff-count'

// Proves #38's delivery mechanism end to end: a prerendered per-country asset the BROWSER
// fetches once at load, not something already resident in the page's initial HTML. Shows a
// row count and nothing else, deliberately — the moment this grows an input with live
// filtering it is #9 (substring search), not this.
export default function TakeoffsPreview({ countryId }: { countryId: number }) {
  const state = useTakeoffCount(countryId)
  return <TakeoffCountView state={state} />
}

// Pure aside from the hook above — exercised directly against literal state in
// index.test.tsx, no fetch mock required. This is the surface a "renders a hardcoded count"
// mutation has to survive: it can only pass by rendering state.count as given, never a
// number baked into the component itself.
export function TakeoffCountView({ state }: { state: TakeoffCountState }) {
  if (state.status === 'loading') return <p className="text-sm opacity-70">Loading takeoffs…</p>
  if (state.status === 'error') return <p className="text-sm text-red-600">{state.message}</p>
  return <p className="text-sm">{state.count} takeoffs loaded</p>
}
