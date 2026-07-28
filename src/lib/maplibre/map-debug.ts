const VERIFY_MAP_QUERY_PARAM = '__verifyMap'

// A single opt-in query param, not a NODE_ENV gate, shared by every browser-verification handle
// in this app (see track-map.tsx and takeoffs-map.tsx): `next start` always runs with
// NODE_ENV=production, unconditionally, and scripts/verify-*.mts is required to run against a
// real production build to catch bundler-specific failures a dev server would never hit (see
// README's maplibre-gl v6/Turbopack note) — an env gate would silently strip the handle from
// exactly the build these scripts exist to test. The param keeps the handle off ORDINARY
// production navigation (nobody lands on this query param by accident); it does not keep it off
// production outright, since anyone who appends the param themselves still enables it on real
// production output. Each call site documents why that residual exposure is acceptable for its
// own data.
export function isMapDebugEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(VERIFY_MAP_QUERY_PARAM)
}
