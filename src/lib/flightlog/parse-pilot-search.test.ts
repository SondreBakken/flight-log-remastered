import { describe, expect, it } from 'vitest'
import { parsePilotSearch } from './parse-pilot-search'

// Trimmed from the real `a=114` grouped-results response (`user_fullname=nde`), real quirks
// preserved: results are NOT a table — country names are bare text nodes, pilots are
// `&nbsp;&nbsp;&nbsp;<a>Name</a>` siblings, all separated by `<br>`, inside the same div that
// holds the search `<form>` itself — and a non-ASCII name (Samúel Alexandersson). The France/
// India/etc. groups between Denmark and Iceland are dropped for brevity; nothing about them
// differs structurally from Colombia/Denmark/Iceland. One row is constructed rather than
// lifted verbatim: a honeypot-shaped anchor placed *inside* the Denmark group, carrying a
// real-looking `a=28&user_id=` href — real traps only ever appear in the shared nav chrome
// above this div (see the untouched `hp-nav` line kept below from the actual response), so
// this proves the parser rejects one by its markers even when structural position alone
// would not save it.
const GROUPED_RESULTS_HTML = `<html><body>
<table width='96%'><tr><td><a href='/resources/1cea74e618fdd81e' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a></td></tr></table>
<div style='padding:0px 10px'>

      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'>
      <input name='form' type='hidden' value='find_user'> Find pilot (wildcards: % _): <input name='user_fullname' type='text' size='15' style='font-size:9px' value='nde'>
      <input name='go' type='submit' value='Go' style='font-size:9px'>
      </form>
      Colombia:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=6924'>JHON ALEXANDER QUINTERO GUTIERREZ</a><br>Denmark:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=8167'>Anders Steffensen</a><br>&nbsp;&nbsp;&nbsp;<a href='/fl.html?a=28&user_id=99999' class='hp-nav' style='position:absolute;left:-9999px;top:-9999px;' rel='nofollow' data-trap='1'>Resources</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=11048'>Lars Funder</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=10258'>Sofie K. H. Andersen</a><br>Iceland:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=5206'>Bent Kingo Andersen</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=5271'>Samúel Alexandersson</a><br><hr>
</div>
</div>n:p:a2</body></html>`

// Verbatim (trimmed) from the real zero-match response (`user_fullname=zzznomatchxyz123`):
// the "-1 No match found" banner, then the same form-holding div with nothing after the
// `</form>` — no results, but the container (and the form anchor) are still present.
const ZERO_MATCH_HTML = `<html><body>
<div style='background-color:yellow'>-1 No match found</div>
<div style='padding:0px 10px'>

      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'>
      <input name='form' type='hidden' value='find_user'> Find pilot (wildcards: % _): <input name='user_fullname' type='text' size='15' style='font-size:9px' value='zzznomatchxyz123'>
      <input name='go' type='submit' value='Go' style='font-size:9px'>
      </form>

</div>
</div>n:p:a2</body></html>`

// The real login page's own form — a=37, unrelated to pilot search — used to prove the a=114
// anchor is a genuine identity check (`isSearchForm`), not "the first form on the page": if that
// predicate degenerated into matching any form, this page would resolve a results container
// (the div below the login form) instead of correctly finding no a=114 form at all.
const LOGIN_PAGE_HTML = `<html><body>
<form method='post' action='/fl.html?l=1&a=37'>
<input name='form' type='hidden' value='login'>
<input name='login_name' type='text'>
<input name='pw' type='password'>
</form>
<div style='padding:0px 10px'>Welcome back</div>
</body></html>`

describe('parsePilotSearch', () => {
  it('groups pilots under their country header, decodes non-ASCII, and excludes an in-results honeypot', () => {
    const results = parsePilotSearch(GROUPED_RESULTS_HTML)

    expect(results).toEqual([
      { userId: 6924, name: 'JHON ALEXANDER QUINTERO GUTIERREZ', country: 'Colombia' },
      { userId: 8167, name: 'Anders Steffensen', country: 'Denmark' },
      { userId: 11048, name: 'Lars Funder', country: 'Denmark' },
      { userId: 10258, name: 'Sofie K. H. Andersen', country: 'Denmark' },
      { userId: 5206, name: 'Bent Kingo Andersen', country: 'Iceland' },
      { userId: 5271, name: 'Samúel Alexandersson', country: 'Iceland' },
    ])
    expect(results.some((result) => result.userId === 99999)).toBe(false)
  })

  it('returns an empty list — not a throw — for a genuine zero-match response', () => {
    expect(parsePilotSearch(ZERO_MATCH_HTML)).toEqual([])
  })

  it('throws rather than returning an empty list when the search form itself is missing (unrelated page)', () => {
    const unrelatedPageHtml = `<html><body><div style='padding:0px 10px'><table><tr><td>not a search page</td></tr></table></div></body></html>`

    expect(() => parsePilotSearch(unrelatedPageHtml)).toThrow(/no search form found/i)
  })

  // B3: the form-action anchor is what keeps a completely different page (one that also has a
  // `<form>`, just not the a=114 one) from being misread as a pilot-search results container.
  // A predicate that matched any form would resolve this page's chrome div as the "container"
  // and, finding no matches inside it, throw for the WRONG reason (zero candidates, no banner)
  // instead of the right one (no a=114 form at all) — asserting the specific message is what
  // tells those two apart.
  it('does not treat an unrelated page carrying its own, non-a=114 form (e.g. login) as the results container', () => {
    expect(() => parsePilotSearch(LOGIN_PAGE_HTML)).toThrow(/no search form found/i)
  })

  it('throws rather than silently dropping a row when a candidate link uses an unexpected action code', () => {
    // Candidate detection is on "any non-honeypot anchor", independent of the expected a=28
    // action code, so a drifted code still counts the row as a candidate that then fails
    // strict extraction, tripping the floor instead of quietly vanishing from the results.
    const wrongActionHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=29&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(wrongActionHtml)).toThrow(/partially unparsed: 0\/1/)
  })

  it('throws rather than accepting a numeric-suffix action code that merely contains "a=28" as a substring (e.g. a=280)', () => {
    // A bare `href.includes('a=28')` would wrongly accept this — a=280 is not a=28.
    const numericSuffixHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=280&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(numericSuffixHtml)).toThrow(/partially unparsed: 0\/1/)
  })

  it('throws rather than silently dropping a row whose country header is missing', () => {
    const noCountryHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      <a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(noCountryHtml)).toThrow(/partially unparsed: 0\/1/)
  })

  it('throws rather than silently misfiling a stray non-header text node (e.g. a result-count banner) as a country', () => {
    const strayTextHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Showing 1 result<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(strayTextHtml)).toThrow(/unexpected text/i)
  })

  it('throws rather than silently dropping a row whose href is missing user_id entirely (a ghost row)', () => {
    const ghostRowHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(ghostRowHtml)).toThrow(/partially unparsed: 0\/1/)
  })

  // The real trap in GROUPED_RESULTS_HTML above carries all three honeypot markers
  // (`class='hp-nav'`, `data-trap`, `rel="nofollow"`) at once, which is realistic but means that
  // fixture alone can't tell "the selector checks all three" apart from "the selector checks any
  // one of the three" — dropping two of the three clauses from HONEYPOT_SELECTOR would still
  // exclude that row via the one clause left. These isolate each marker so every clause in the
  // selector is independently load-bearing.
  it.each([
    ["class='hp-nav'", `<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=99999' class='hp-nav'>Resources</a>`],
    ['data-trap', `<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=99999' data-trap='1'>Resources</a>`],
    ["rel='nofollow'", `<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=99999' rel='nofollow'>Resources</a>`],
  ])('excludes a trap carrying only the %s marker, with no other honeypot attribute', (_label, trapAnchor) => {
    const html = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>${trapAnchor}<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(parsePilotSearch(html)).toEqual([{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }])
  })

  it('dedupes a userId that legitimately appears as a candidate twice, so the caller never sees a duplicate React key', () => {
    const duplicateUserIdHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(parsePilotSearch(duplicateUserIdHtml)).toEqual([
      { userId: 754, name: 'Nils Aage Henden', country: 'Norway' },
    ])
  })

  // B2: applied against the real 407-row fixture, all four of these previously returned an
  // empty list where they must throw — candidates.length === 0 is what a genuine zero-match
  // response looks like too, so the "-1 No match found" banner is the only thing that tells a
  // real zero-match apart from markup drift severe enough that nothing was even recognised as
  // a candidate.
  describe('markup drift that yields zero candidates without a genuine zero match', () => {
    it('throws when every result row is wrapped in an extra <span>, hiding the anchor from the direct-children walk', () => {
      const spanWrappedHtml = `<html><body><div style='padding:0px 10px'>
        <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
        Norway:<br><span>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a></span><br><hr>
        </div></body></html>`

      expect(() => parsePilotSearch(spanWrappedHtml)).toThrow(/zero candidate rows/i)
    })

    it('throws when the results are moved into an extra <div> inside the container', () => {
      const nestedDivHtml = `<html><body><div style='padding:0px 10px'>
        <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
        <div>Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr></div>
        </div></body></html>`

      expect(() => parsePilotSearch(nestedDivHtml)).toThrow(/zero candidate rows/i)
    })

    it('throws when the form itself is moved one level deeper, so form.parent() is no longer the real results container', () => {
      const formNestedDeeperHtml = `<html><body><div style='padding:0px 10px'>
        <div class='mystery-wrapper'><form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form></div>
        Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
        </div></body></html>`

      expect(() => parsePilotSearch(formNestedDeeperHtml)).toThrow(/zero candidate rows/i)
    })

    it('throws when user_id= is renamed site-wide, since the broadened candidate detection still counts the row (and then fails to extract it)', () => {
      const renamedIdParamHtml = `<html><body><div style='padding:0px 10px'>
        <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
        Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=28&uid=754'>Nils Aage Henden</a><br><hr>
        </div></body></html>`

      expect(() => parsePilotSearch(renamedIdParamHtml)).toThrow(/partially unparsed: 0\/1/)
    })
  })
})
