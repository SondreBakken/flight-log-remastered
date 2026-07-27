import { describe, expect, it } from 'vitest'
import TakeoffsPage from './page'

describe('TakeoffsPage route guard', () => {
  it.each(['0', '-5', 'abc', '', '999'])(
    'renders notFound for a malformed or uncurated countryId %j',
    async (countryId) => {
      await expect(TakeoffsPage({ params: Promise.resolve({ countryId }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
    },
  )

  // Every alias here normalises to 160 under plain `Number()` (and `Number.isInteger` is
  // true for all of them too), so a guard built on `Number()` + `Number.isInteger` alone
  // would render the preview for each — a distinct URL per alias, none of them prerendered.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'renders notFound for the alias %j even though it normalises to 160',
    async (alias) => {
      await expect(TakeoffsPage({ params: Promise.resolve({ countryId: alias }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
    },
  )

  it('renders the preview with the parsed numeric id for a curated countryId', async () => {
    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }) })

    expect(element.props.countryId).toBe(160)
  })
})
