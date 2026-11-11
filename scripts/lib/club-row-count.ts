// Pure row counting and drift detection for check-clubs-prerender.mts, split out so the
// selectors and the drift message are unit-testable without a build.
//
// The row class is a styling token (browse-country-clubs/index.tsx), not a contract: when it
// changes, update CLUB_ROW_CLASS here. The header row carries the same classes plus
// `text-left`, so an exact-class match excludes it.
export const CLUB_ROW_CLASS = 'border-b border-rule'

const HTML_ROW_PATTERN = new RegExp(`<tr class="${CLUB_ROW_CLASS}">`, 'g')
const RSC_ROW_PATTERN = new RegExp(`\\["\\$","tr","\\d+",\\{"className":"${CLUB_ROW_CLASS}"`, 'g')

export function countHtmlClubRows(html: string): number {
  return (html.match(HTML_ROW_PATTERN) ?? []).length
}

export function countRscClubRows(rsc: string): number {
  return (rsc.match(RSC_ROW_PATTERN) ?? []).length
}

export type RowCountVerdict =
  | { kind: 'selector-drift'; message: string }
  | { kind: 'count'; ok: boolean; label: string }

// Zero rows after the club-count text matched means the text rendered but the selector no
// longer finds the rows, so name that instead of a bare count mismatch. When the count text
// did not match (empty or fallback shell) the plain count label is kept.
export function judgeClubRowCount(file: string, countTextMatched: boolean, rowCount: number, expectedRowCount: number, verb: string): RowCountVerdict {
  if (countTextMatched && rowCount === 0) {
    return {
      kind: 'selector-drift',
      message: `${file}: club count text matched but 0 rows found, row class selector drift (expected rows with class "${CLUB_ROW_CLASS}")`,
    }
  }
  return { kind: 'count', ok: rowCount === expectedRowCount, label: `${file}: ${verb} ${expectedRowCount} club table rows (found ${rowCount})` }
}
