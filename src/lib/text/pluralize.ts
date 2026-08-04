// Generic/domain-agnostic — shared by browse-pilot-statistics and browse-flown-sites-map (and
// anything else) instead of each carrying its own verbatim copy of the same one-liner.
export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
