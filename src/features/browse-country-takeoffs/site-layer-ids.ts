// MapLibre source/layer ids shared between takeoffs-map.tsx, which builds them, and
// scripts/verify-sites-map.mts, which queries them from a real browser to prove clustering
// and layer configuration actually work. Kept in their own module — no maplibre-gl import, no
// CSS, no React — specifically so the Node-side verify script can import this file directly
// (via `tsx`, the same way scripts/check-*.mts already import plain source modules from
// `src/`) rather than hardcode a second copy of the same literals that could silently drift
// from the ones the map component actually builds.
export const SITES_SOURCE_ID = 'takeoff-sites'
export const RAYS_SOURCE_ID = 'wind-rays'
export const CLUSTER_LAYER_ID = 'takeoff-clusters'
export const UNCLUSTERED_NONE_LAYER_ID = 'takeoff-site-none'
export const UNCLUSTERED_ALL_LAYER_ID = 'takeoff-site-all'
export const UNCLUSTERED_SOME_LAYER_ID = 'takeoff-site-some'
export const WIND_RAY_LAYER_ID = 'wind-ray-lines'
