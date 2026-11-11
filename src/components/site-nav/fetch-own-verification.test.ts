import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOwnVerification } from './fetch-own-verification'

function answerWith(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchOwnVerification', () => {
  it.each(['none', 'pending', 'verified'] as const)('reads %s from the own-verification route', async (status) => {
    answerWith(200, { status })

    expect(await fetchOwnVerification()).toBe(status)
    expect(fetch).toHaveBeenCalledWith('/api/account/verification')
  })

  it.each([401, 503])('throws, rather than reading as none, when the route answers %i', async (code) => {
    answerWith(code, { error: 'x' })

    await expect(fetchOwnVerification()).rejects.toThrow(String(code))
  })

  it.each([{ status: 'locked-out' }, { status: 1 }, {}, null, 'verified'])('throws on the body %j', async (body) => {
    answerWith(200, body)

    await expect(fetchOwnVerification()).rejects.toThrow('unexpected body')
  })
})
