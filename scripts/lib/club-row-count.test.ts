import { describe, expect, it } from 'vitest'
import { CLUB_ROW_CLASS, countHtmlClubRows, countRscClubRows, judgeClubRowCount } from './club-row-count'

const HTML_HEADER = '<tr class="border-b border-rule text-left">'
const HTML_ROW = '<tr class="border-b border-rule">'
const RSC_HEADER = '["$","tr","h",{"className":"border-b border-rule text-left","children":[]}]'
const RSC_ROW = '["$","tr","12",{"className":"border-b border-rule","children":[]}]'

describe('countHtmlClubRows', () => {
  it('counts body rows and skips the header row', () => {
    expect(countHtmlClubRows(`${HTML_HEADER}${HTML_ROW}${HTML_ROW}`)).toBe(2)
  })
  it('does not match the old class', () => {
    expect(countHtmlClubRows('<tr class="border-b border-black/5 dark:border-white/10">')).toBe(0)
  })
})

describe('countRscClubRows', () => {
  it('counts body rows and skips the header row', () => {
    expect(countRscClubRows(`${RSC_HEADER}\n${RSC_ROW}${RSC_ROW}${RSC_ROW}`)).toBe(3)
  })
  it('does not match the old class', () => {
    expect(countRscClubRows('["$","tr","1",{"className":"border-b border-black/5 dark:border-white/10"')).toBe(0)
  })
})

describe('judgeClubRowCount', () => {
  it('names selector drift, with the class, when the count text matched but 0 rows were found', () => {
    const verdict = judgeClubRowCount('x.html', true, 0, 91, 'renders')
    expect(verdict.kind).toBe('selector-drift')
    expect(verdict).toMatchObject({ message: expect.stringContaining('row class selector drift') })
    expect(verdict).toMatchObject({ message: expect.stringContaining(`"${CLUB_ROW_CLASS}"`) })
  })
  it('keeps the plain count label when the count text did not match', () => {
    expect(judgeClubRowCount('x.html', false, 0, 91, 'renders')).toEqual({
      kind: 'count',
      ok: false,
      label: 'x.html: renders 91 club table rows (found 0)',
    })
  })
  it('passes on the expected count and fails on a nonzero mismatch', () => {
    expect(judgeClubRowCount('x.rsc', true, 91, 91, 'serializes')).toMatchObject({ kind: 'count', ok: true })
    expect(judgeClubRowCount('x.rsc', true, 90, 91, 'serializes')).toMatchObject({ kind: 'count', ok: false })
  })
})
