import { describe, expect, it } from 'vitest'
import { parseCountries } from './parse-countries'

// Trimmed from the real `rqtid=9` response, with the id-not-name-sorted quirk actually
// reproduced: id 237 (Congo, The Democratic Republic Of The) sits in insertion order
// between id 49 (Congo, Republic of the) and id 50 (Cook Islands) — alphabetically between
// them, numerically nowhere near — plus Norway for the known-id assertion below.
const COUNTRIES_HTML = `<html><body><table border=1><th>a2_code</th><th>a3_code</th><th>createdby</th><th>createdtime</th><th>id</th><th>name</th><th>num_code</th><th>timestamp</th><th>updatedby</th><th>updatedtime</th><th>fips_a2</th><tr><td>CG</td><td>COG</td><td>1</td><td>2002-02-22 22:03:23</td><td>49</td><td>Congo, Republic of the</td><td>178</td><td>2005-09-03 18:06:07</td><td>1</td><td>2005-09-03 20:06:07</td><td>CF</td></tr>
<tr><td>CD</td><td>COD</td><td>1</td><td>2002-02-22 22:03:23</td><td>237</td><td>Congo, The Democratic Republic Of The</td><td>180</td><td>2005-09-03 21:47:18</td><td>1</td><td>2005-09-03 20:06:07</td><td>CG</td></tr>
<tr><td>CK</td><td>COK</td><td>1</td><td>2002-02-22 22:03:23</td><td>50</td><td>Cook Islands</td><td>184</td><td>2005-09-03 18:06:07</td><td>1</td><td>2005-09-03 20:06:07</td><td>CW</td></tr>
<tr><td>NO</td><td>NOR</td><td>1</td><td>2002-02-22 22:03:23</td><td>160</td><td>Norway</td><td>578</td><td>2005-09-03 18:06:11</td><td>1</td><td>2005-09-03 20:06:11</td><td>NO</td></tr>
</table></body></html>`

describe('parseCountries', () => {
  it('reads id from cell 5 and name from cell 6, in document order rather than id order', () => {
    const countries = parseCountries(COUNTRIES_HTML)

    expect(countries).toEqual([
      { countryId: 49, name: 'Congo, Republic of the' },
      { countryId: 237, name: 'Congo, The Democratic Republic Of The' },
      { countryId: 50, name: 'Cook Islands' },
      { countryId: 160, name: 'Norway' },
    ])
  })

  it('throws rather than returning an empty list when the table shape is not recognised', () => {
    const unrecognisedHtml = '<html><body><div>flightlog.org</div></body></html>'

    expect(() => parseCountries(unrecognisedHtml)).toThrow()
  })

  it('throws rather than silently dropping a row whose id cell is empty', () => {
    const emptyIdHtml = `<html><body><table border=1><tr><td>NO</td><td>NOR</td><td>1</td><td>2002-02-22 22:03:23</td><td></td><td>Norway</td><td>578</td><td>2005-09-03 18:06:11</td><td>1</td><td>2005-09-03 20:06:11</td><td>NO</td></tr></table></body></html>`

    expect(() => parseCountries(emptyIdHtml)).toThrow()
  })

  it('throws rather than accepting a hex-looking id cell as its decoded value', () => {
    const hexIdHtml = `<html><body><table border=1><tr><td>NO</td><td>NOR</td><td>1</td><td>2002-02-22 22:03:23</td><td>0x10</td><td>Norway</td><td>578</td><td>2005-09-03 18:06:11</td><td>1</td><td>2005-09-03 20:06:11</td><td>NO</td></tr></table></body></html>`

    expect(() => parseCountries(hexIdHtml)).toThrow()
  })

  it('throws rather than accepting a negative id cell', () => {
    const negativeIdHtml = `<html><body><table border=1><tr><td>NO</td><td>NOR</td><td>1</td><td>2002-02-22 22:03:23</td><td>-160</td><td>Norway</td><td>578</td><td>2005-09-03 18:06:11</td><td>1</td><td>2005-09-03 20:06:11</td><td>NO</td></tr></table></body></html>`

    expect(() => parseCountries(negativeIdHtml)).toThrow()
  })
})
