// The barogram's altitude line stays this single flat colour. The map's track line is
// now coloured by altitude (see altitude-color.ts), but its ramp anchors its low end on
// this same blue, so the two views of a flight still read as related.
export const TRACK_LINE_COLOR = '#2563eb'

// The scoring overlay's line and turnpoint markers (#15): amber, deliberately outside the
// altitude ramp's blue-to-red range and distinct from TRACK_LINE_COLOR, so an overlaid
// scoring line never reads as just another altitude-coloured segment of the track itself.
export const SCORING_LINE_COLOR = '#f59e0b'
