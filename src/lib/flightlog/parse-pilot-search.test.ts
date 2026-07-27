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

    expect(() => parsePilotSearch(unrelatedPageHtml)).toThrow()
  })

  it('throws rather than silently dropping a row when a candidate link uses an unexpected action code', () => {
    // Candidate detection keys on `user_id=` alone, independent of the expected a=28 action
    // code, so a drifted code still counts the row as a candidate that then fails strict
    // extraction, tripping the floor instead of quietly vanishing from the results.
    const wrongActionHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      Norway:<br>&nbsp;&nbsp;&nbsp;<a href='https://flightlog.org/fl.html?l=1&a=29&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(wrongActionHtml)).toThrow()
  })

  it('throws rather than silently dropping a row whose country header is missing', () => {
    const noCountryHtml = `<html><body><div style='padding:0px 10px'>
      <form method='post' style='margin:0px;' action='/fl.html?l=1&a=114'></form>
      <a href='https://flightlog.org/fl.html?l=1&a=28&user_id=754'>Nils Aage Henden</a><br><hr>
      </div></body></html>`

    expect(() => parsePilotSearch(noCountryHtml)).toThrow()
  })
})
