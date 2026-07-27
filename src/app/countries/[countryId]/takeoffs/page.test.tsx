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

  it('renders the preview with the parsed numeric id for a curated countryId', async () => {
    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }) })

    expect(element.props.countryId).toBe(160)
  })
})
