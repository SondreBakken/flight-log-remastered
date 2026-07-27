// Folds a name down to something comparable for a case- and accent-insensitive substring
// search — generic text logic, not specific to takeoffs or Norway, even though the letters
// it was written against (å, ø, æ) are Norwegian. Four separate techniques, layered, because
// no single one covers what this app's actual Norway fixture contains (2827 occurrences of
// ø/æ across names like Bodø, Øksnanuten, Bærum, Fjærland, Ægirbakken — 2506 ø, 321 æ):
//
// 1. `String.prototype.normalize('NFD')` decomposes a precomposed accented letter into its
//    base letter plus one or more combining marks — å becomes `a` + U+030A (combining ring
//    above). Stripping the combining-mark Unicode block after normalizing handles å, and any
//    other decomposable accented letter (é, ü, ö, ...), for free.
// 2. ø (U+00F8) and æ (a genuine ligature, not an accented letter) have NO Unicode
//    decomposition at all — NFD leaves both completely untouched. They need an explicit
//    character map instead, applied after the NFD step.
// 3. Even after (1) and (2), a query that spells a folded vowel with a different number of
//    repeats than the name does still can't line up as a substring — see
//    collapseRepeatedLetters below for why, and what it costs.
// 4. Real names in the fixture carry double spaces (e.g. takeoffId 1786, "Bodø Tverlandet
//    Oddan", has two spaces between "Tverlandet" and "Oddan") that a pilot typing what they
//    see on screen would spell with one — see collapseWhitespace below.
const CHARACTER_FOLD: Readonly<Record<string, string>> = {
  ø: 'o',
  æ: 'ae',
}

function stripCombiningMarks(value: string): string {
  // \p{M} is the Unicode "Mark" category (combining marks, including the combining ring
  // above that NFD produces for å) — a property escape instead of a hardcoded code point
  // range, since a literal range is exactly the kind of thing that silently mis-renders
  // when it's typed as literal characters instead of \uXXXX escapes.
  return value.normalize('NFD').replace(/\p{M}/gu, '')
}

function applyCharacterFold(value: string): string {
  return Array.from(value, (char) => CHARACTER_FOLD[char] ?? char).join('')
}

// Collapses runs of the same letter down to one: "vagaa" -> "vaga". Needed because folding a
// single å down to a single `a` and a query that spells that vowel doubled (or the other way
// round) otherwise can never line up as a substring — å -> a folds "Vågå" (the issue's own
// example) to "vaga" (4 letters), which the 5-letter query "vagaa" cannot be a substring of
// at all, doubled or not. Collapsing BOTH sides the same way is what lets them meet in the
// middle: "vaga" stays "vaga" (no repeats to begin with), "vagaa" collapses to "vaga" too.
//
// This has a real false-positive cost, not a free lunch: two names that differ only in how
// many times a letter repeats become indistinguishable after folding. A place spelled with a
// single consonant and another spelled with the same consonant doubled (e.g. "Sona" versus a
// hypothetical "Sonna") fold to the same searchable string, and this search can no longer
// tell them apart — a doubled-letter false positive, accepted deliberately. The issue's own
// worked example cannot be satisfied without this collapse, and an occasional extra,
// similar-looking result is a smaller cost than the search silently failing on the exact case
// it was filed to fix.
function collapseRepeatedLetters(value: string): string {
  // \p{L} (Unicode "Letter" category) scopes this to letters — a bare `.` also collapses
  // digits, whitespace and punctuation, which this rule was never meant to touch: a query of
  // "--", "1111" or "..." would fold down to a single character and then match almost every
  // name containing that run.
  return value.replace(/(\p{L})\1+/gu, '$1')
}

// Collapses a run of whitespace down to a single space: "Tverlandet  Oddan" (a real fixture
// name, double-spaced) -> "Tverlandet Oddan". Scoping collapseRepeatedLetters to \p{L} above
// was correct — it must not touch digits or punctuation — but that same scoping means it
// leaves whitespace runs untouched too, and 79 real Norway names carry a double space where
// the same name typed by a pilot would only have one. Without this, a query typed with a
// single space (what's visibly on screen) cannot be a substring of a folded name that still
// carries two.
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ')
}

export function foldForSearch(value: string): string {
  return collapseWhitespace(collapseRepeatedLetters(applyCharacterFold(stripCombiningMarks(value.toLowerCase()))))
}

// Substring, not prefix — Norwegian site names are frequently compounds (Øksnanuten,
// Fjærland), and pilots type the second half, per the issue's own note. An empty query folds
// to the empty string, which `String.prototype.includes` treats as a substring of anything —
// deliberately: no query typed yet means "show everything," not "show nothing."
export function matchesFoldedQuery(name: string, query: string): boolean {
  return foldForSearch(name).includes(foldForSearch(query))
}
