// Generic, domain-agnostic — a floor/ceiling pair and the two ways every check script in this
// repo consumes one. Extracted because the comparison was open-coded at six call sites across
// check-takeoffs-prerender.mts, check-clubs-prerender.mts, verify-takeoffs.mts and
// verify-sites-map.mts, four of which indexed `range[0]`/`range[1]` in the condition and then
// repeated both endpoints again in the message (#55).
export type Range = readonly [number, number]

export function inRange(value: number, range: Range): boolean {
  return value >= range[0] && value <= range[1]
}

export function formatRange(range: Range): string {
  return `${range[0]}-${range[1]}`
}
