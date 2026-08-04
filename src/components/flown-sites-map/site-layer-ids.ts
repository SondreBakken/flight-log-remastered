// MapLibre source/layer ids shared between index.tsx, which builds them, and
// scripts/verify-flown-sites.mts, which queries them from a real browser — same split as
// takeoffs-map/site-layer-ids.ts, and for the same reason: no maplibre-gl import, no CSS, no
// React, so the Node-side verify script can import this file directly via `tsx` without a
// second hand-kept copy of the same literals drifting from what the map component actually
// builds.
export const FLOWN_SITES_SOURCE_ID = 'flown-sites'
export const FLOWN_SITES_LAYER_ID = 'flown-site-markers'
