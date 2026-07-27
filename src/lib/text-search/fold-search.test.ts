import { describe, expect, it } from 'vitest'
import { foldForSearch, matchesFoldedQuery } from './fold-search'

describe('foldForSearch — the fold table', () => {
  // One row per special letter, asserted individually — a fixture using only å would pass an
  // implementation that is wrong for the other two thirds of what it claims to handle: ø
  // (U+00F8) has no Unicode decomposition at all, and æ is a genuine ligature, also no
  // decomposition. Both pass a bare NFD-strip completely unchanged.
  it.each([
    ['å', 'a'],
    ['Å', 'a'],
    ['ø', 'o'],
    ['Ø', 'o'],
    ['æ', 'ae'],
    ['Æ', 'ae'],
  ])('folds %j to %j', (input, expected) => {
    expect(foldForSearch(input)).toBe(expected)
  })

  // Real compound names from the Norway fixture, each carrying a different one (or, for
  // Ægirbakken, two different kinds) of the folding rules above, not synthetic single-letter
  // input.
  it.each([
    ['Bodø', 'bodo'],
    ['Ålesund', 'alesund'],
    ['Fjærland', 'fjaerland'],
    ['Bærum', 'baerum'],
    ['Øksnanuten', 'oksnanuten'],
    // æ -> 'ae' plus the doubled 'kk' in "bakken" collapsing to one 'k' — both rules firing
    // on the same name.
    ['Ægirbakken', 'aegirbaken'],
  ])('folds the real fixture name %j to %j', (input, expected) => {
    expect(foldForSearch(input)).toBe(expected)
  })

  it('collapses a run of a repeated letter to one', () => {
    expect(foldForSearch('vagaa')).toBe('vaga')
  })

  // Documents the collapse's own false-positive cost (see collapseRepeatedLetters' doc
  // comment): a genuine doubled consonant folds away identically to its single-letter
  // spelling, so two different real names could become indistinguishable under this search.
  it('collapses a genuine doubled consonant the same way it collapses a repeated vowel — the deliberate false-positive cost', () => {
    expect(foldForSearch('Hallingdal')).toBe('halingdal')
  })

  it('lowercases plain ASCII input that needs no other folding', () => {
    expect(foldForSearch('VAGAA')).toBe('vaga')
    expect(foldForSearch('Oslo')).toBe('oslo')
  })
})

describe('matchesFoldedQuery — the required cases from #9', () => {
  it("the issue's own literal example: Vagaa finds Vågå", () => {
    expect(matchesFoldedQuery('Vågå', 'Vagaa')).toBe(true)
  })

  it('Bodo finds Bodø', () => {
    expect(matchesFoldedQuery('Bodø', 'Bodo')).toBe(true)
  })

  it('Alesund finds Ålesund', () => {
    expect(matchesFoldedQuery('Ålesund', 'Alesund')).toBe(true)
  })

  it('Fjaerland finds Fjærland', () => {
    expect(matchesFoldedQuery('Fjærland', 'Fjaerland')).toBe(true)
  })

  it('matches a substring in the second half of a compound name, not just a prefix', () => {
    expect(matchesFoldedQuery('Nordøyane', 'oyane')).toBe(true)
    // Pins substring matching specifically: the query is a real substring of the folded name
    // but NOT a prefix of it, so a prefix-only implementation would fail this one case even
    // though it could still pass every "Bodo finds Bodø"-shaped case above (all of which
    // happen to match at position 0).
    expect(foldForSearch('Nordøyane').startsWith(foldForSearch('oyane'))).toBe(false)
  })

  it('matches case-insensitively both ways', () => {
    expect(matchesFoldedQuery('BODØ', 'bodo')).toBe(true)
    expect(matchesFoldedQuery('bodø', 'BODO')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesFoldedQuery('Bodø', 'Alesund')).toBe(false)
  })

  it('an empty query matches every name — the directory browses when nothing has been typed yet', () => {
    expect(matchesFoldedQuery('Bodø', '')).toBe(true)
    expect(matchesFoldedQuery('', '')).toBe(true)
  })
})
