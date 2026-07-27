// Rounded to whole metres: StatGrid, the map legend and the barogram's slider aria-valuetext
// all display altitude as a label a person reads (or hears) at a glance, not a precise
// measurement, and this matches AltitudeLabels' axis ticks (barogram.tsx), which round the
// same way. A raw scraped altitude can carry sub-metre noise from the source GPS fix;
// rounding it here is a deliberate display choice, not an accident of the value's origin.
export function formatAltitude(metres: number | null): string {
  return metres === null ? '—' : `${Math.round(metres)} m`
}
