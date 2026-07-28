import type { GeoPoint } from '@/lib/geo/distance'

// flightlog.org's own coordinate-placeholder convention — not generic geo math (see
// lib/geo/distance.ts for that), so this lives alongside the rest of this app's
// flightlog.org-specific parsing/business knowledge rather than in lib/geo. Shared by the
// takeoffs directory's nearby filter, the takeoffs map (src/components/takeoffs-map), and the
// takeoff detail route, all of which need to agree on what counts as a usable position.
//
// flightlog.org's placeholder for "no coordinates ever recorded" sets BOTH axes to exactly
// 0 — 0,0 sits in the Gulf of Guinea, nowhere near any real takeoff, so treating it as an
// actual position would report a confident, wrong distance (thousands of km) as fact. 1948
// of Norway's 6012 takeoffs (32.4%) carry this placeholder.
//
// The full 0,0 placeholder isn't the only shape of coordinate corruption in the real
// dataset, though (confirmed against fixtures/takeoffs-160.html). Two more, both still
// inside the rows that pass the 0,0 check alone:
//   - exactly ONE axis reset to 0 while the other still holds a real-looking value, e.g.
//     takeoff 8478 "Veines (Kongsfjord)" carries lat=0, lon=70.73 — its real latitude
//     (70.72N) landed in the longitude column, not a real position at 0N.
//   - BOTH axes corrupted to a small non-zero remainder near Null Island, e.g. takeoff
//     10778 "Auenhaugen, Golsfjellet" carries lat=-1.02, lon=1.02 (the real site is
//     ~60.7N 9.0E). No real takeoff in this dataset — Norwegian or the ~30 genuinely French
//     rows flightlog.org files under the same country id — sits within a few degrees of
//     0,0; the nearest legitimate low-latitude row is at 39.3N.
// Both shapes plot inside the Gulf of Guinea / off the African coast exactly like the full
// placeholder, and both feed the same two consequences the full placeholder does: a
// fabricated "nearby" distance, and a blown-out map viewport. One predicate excludes all
// three shapes rather than three separate, driftable checks.
const NULL_ISLAND_RADIUS_DEGREES = 5

// A plain GeoPoint (lat/lon), not a fuller takeoff/row type — this predicate only ever reads
// those two fields, so a caller (a server route, a client feature, a map data builder) can pass
// whatever richer shape it already has rather than importing a specific feature's wire type
// just to satisfy this function's parameter. A server route in particular must not depend on a
// client feature's wire type just to call this.
export function hasKnownLocation(point: GeoPoint): boolean {
  const { lat, lon } = point
  if (lat === 0 || lon === 0) return false
  return Math.abs(lat) > NULL_ISLAND_RADIUS_DEGREES || Math.abs(lon) > NULL_ISLAND_RADIUS_DEGREES
}
