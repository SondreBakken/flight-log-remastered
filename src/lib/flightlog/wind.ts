// Decodes the `wind` integer a takeoff carries (Takeoff.wind, rqtid=11) into the compass
// octants it represents. #10 (map arrows) and #12 (wind filter) both need this and neither
// should invent its own copy — see issue #43.
//
// Pinned by cross-referencing live Norway takeoffs' `wind` values against their a=22 detail
// pages, which render the same bits as a compass image whose plain-text `alt` names the
// active octants (e.g. wind=255 -> alt=" N NE E SE S SW W NW"). All 8 bits are confirmed
// directly, each as its own single-bit value — including bits 2 and 4, which an earlier pass
// had inferred from a single 3-bit sample (wind=28) that turned out to be non-discriminating
// (it reads identically under this mapping and under one with bits 2 and 4 swapped). A second,
// budget-free argument agrees: over all 6012 Norway wind values, 94.4% decode to a circularly
// contiguous compass arc under this mapping vs. 70.4% under the swapped alternative. See
// docs/flightlog-api.md for the full request-by-request table and both arguments.
//
// Bit position runs counter-clockwise starting from N at the top bit, not in bit-index
// order:
//   bit 7 (128) = N     bit 6 (64) = NE   bit 5 (32) = E    bit 4 (16) = SE
//   bit 3 (8)   = S     bit 2 (4)  = SW   bit 1 (2)  = W    bit 0 (1)  = NW

export type CompassOctant = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

// Canonical clockwise order. Also the order flightlog.org's own a=22 page lists active
// directions in — but that's not independent confirmation of "clockwise" as opposed to "bit
// order": under the mapping below, descending bit order (bit7..bit0) and clockwise order are
// the SAME sequence by construction (bit = 7 - clockwiseIndex), so no alt-text sample can ever
// tell those two hypotheses apart, they predict identical output for every wind value.
// decodeWindDirections returns clockwise order because that's the order the site's own alt
// text happens to read as, not because the site's internal iteration was proven semantic
// rather than positional.
const OCTANTS_CLOCKWISE: readonly CompassOctant[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

// bit(direction) = 7 - clockwiseIndex(direction). Derived from OCTANTS_CLOCKWISE rather than
// written out as a second literal, so the two orderings can't drift apart.
const BIT_FOR_OCTANT: Readonly<Record<CompassOctant, number>> = Object.fromEntries(
  OCTANTS_CLOCKWISE.map((octant, clockwiseIndex) => [octant, 7 - clockwiseIndex]),
) as Record<CompassOctant, number>

const VALID_OCTANTS: ReadonlySet<string> = new Set(OCTANTS_CLOCKWISE)

function assertWindByte(wind: number): void {
  if (!Number.isInteger(wind) || wind < 0 || wind > 255) {
    throw new RangeError(`wind must be an integer in [0, 255], got ${wind}`)
  }
}

// #12's filter takes a direction from a URL query parameter — a runtime string the
// CompassOctant type cannot stop from being invalid. Without this, BIT_FOR_OCTANT[octant] on
// an unknown key is undefined, and `1 << undefined` is `1`, silently aliasing every bad octant
// to NW instead of failing loudly the way a corrupt `wind` already does.
function assertOctant(octant: CompassOctant): void {
  if (!VALID_OCTANTS.has(octant)) {
    throw new RangeError(`octant must be one of ${OCTANTS_CLOCKWISE.join(', ')}, got ${JSON.stringify(octant)}`)
  }
}

export function windIncludesDirection(wind: number, octant: CompassOctant): boolean {
  assertWindByte(wind)
  assertOctant(octant)
  return (wind & (1 << BIT_FOR_OCTANT[octant])) !== 0
}

export function decodeWindDirections(wind: number): CompassOctant[] {
  assertWindByte(wind)
  return OCTANTS_CLOCKWISE.filter((octant) => windIncludesDirection(wind, octant))
}
