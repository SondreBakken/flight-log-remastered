import { describe, expect, it } from 'vitest'
import { parseCountries } from './parse-countries'

// Trimmed from a real `rqtid=9` response: the 11 <th> header cells are not wrapped in a
// <tr>, and ids are not name-sorted (id 237 sits alphabetically between other ids in the
// real payload) — reproduced here as evidence that cell index, not row order, is what the
// parser must read.
const COUNTRIES_HTML = `<html><body><table border=1><th>a2_code</th><th>a3_code</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>num_code</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><th>fips_a2</th><tr><td>NO</td><td>NOR</td><td>1</td><td>2002-02-22 22:03:23</td><td>160</td><td>Norway</td><td>578</td><td>2005-09-03 18:06:11</td><td>1</td><td>2005-09-03 20:06:11</td><td>NO</td></tr>
<tr><td>SE</td><td>SWE</td><td>1</td><td>2002-02-22 22:03:23</td><td>203</td><td>Sweden</td><td>752</td><td>2005-09-03 18:06:12</td><td>1</td><td>2005-09-03 20:06:12</td><td>SW</td></tr>
<tr><td>FR</td><td>FRA</td><td>1</td><td>2002-02-22 22:03:23</td><td>73</td><td>France</td><td>250</td><td>2005-09-03 18:06:08</td><td>1</td><td>2005-09-03 20:06:08</td><td>FR</td></tr>
</table></body></html>`

describe('parseCountries', () => {
  it('reads id from cell 5 and name from cell 6, matching the known Norway/Sweden/France ids', () => {
    const countries = parseCountries(COUNTRIES_HTML)

    expect(countries).toEqual([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
      { countryId: 73, name: 'France' },
    ])
  })

  it('throws rather than returning an empty list when the table shape is not recognised', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseCountries(unrecognisedHtml)).toThrow()
  })
})
