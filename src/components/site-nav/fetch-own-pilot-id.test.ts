import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOwnPilotId } from './fetch-own-pilot-id'

function answerWith(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchOwnPilotId', () => {
  it('reads the linked pilot id from the own-pilot-id route', async () => {
    answerWith(200, { pilotId: 12677 })

    expect(await fetchOwnPilotId()).toBe(12677)
    expect(fetch).toHaveBeenCalledWith('/api/account/pilot-id')
  })

  it('reads a null pilot id as nothing linked', async () => {
    answerWith(200, { pilotId: null })

    expect(await fetchOwnPilotId()).toBeNull()
  })

  it('throws, rather than reading as nothing linked, when the route answers an error', async () => {
    answerWith(503, { error: 'profile-unavailable' })

    await expect(fetchOwnPilotId()).rejects.toThrow('503')
  })

  it('throws on a body that is not a pilot id', async () => {
    answerWith(200, { pilotId: '12677' })

    await expect(fetchOwnPilotId()).rejects.toThrow('unexpected body')
  })
})
