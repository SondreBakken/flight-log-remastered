import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequestGate, RequestGateTimeoutError } from '@/lib/concurrency/request-gate'
import { gatedFetch, REQUEST_GATE_TIMEOUT_MS } from './outbound-gate'
import type { UpstreamEntry } from './upstream-status'

function newGate(limit = 4) {
  return createRequestGate({ limit, minSpacingMs: 0, timeoutMs: REQUEST_GATE_TIMEOUT_MS })
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('gatedFetch recording', () => {
  it.each([
    ['a 200', () => Promise.resolve(new Response('ok', { status: 200 })), false],
    ['a 302', () => Promise.resolve(new Response('', { status: 302 })), false],
    ['a 404', () => Promise.resolve(new Response('', { status: 404 })), false],
    ['a 500', () => Promise.resolve(new Response('', { status: 500 })), true],
    ['a 503', () => Promise.resolve(new Response('', { status: 503 })), true],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), true],
  ])('records %s with failed=%s', async (_name, impl, failed) => {
    stubFetch(impl)
    const recorder = vi.fn<(entry: UpstreamEntry) => void>()

    await gatedFetch('https://example.test/', {}, newGate(), recorder).catch(() => undefined)

    expect(recorder).toHaveBeenCalledTimes(1)
    expect(recorder.mock.calls[0][0].failed).toBe(failed)
  })

  it('records a timeout once, as a failure near the timeout, and still rejects with the gate error', async () => {
    stubFetch(
      () => new Promise<Response>(() => {}), // never answers
    )
    const recorder = vi.fn<(entry: UpstreamEntry) => void>()

    const result = gatedFetch('https://example.test/', {}, newGate(), recorder)
    const assertion = expect(result).rejects.toBeInstanceOf(RequestGateTimeoutError)
    await vi.advanceTimersByTimeAsync(REQUEST_GATE_TIMEOUT_MS)
    await assertion

    expect(recorder).toHaveBeenCalledTimes(1)
    const entry = recorder.mock.calls[0][0]
    expect(entry.failed).toBe(true)
    expect(entry.latencyMs).toBe(REQUEST_GATE_TIMEOUT_MS)
  })

  it('excludes gate queue time from the recorded latency', async () => {
    const releases: Array<() => void> = []
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('ok')))
        }),
    )
    const recorder = vi.fn<(entry: UpstreamEntry) => void>()
    const gate = newGate(1)

    const first = gatedFetch('https://example.test/1', {}, gate, recorder)
    const second = gatedFetch('https://example.test/2', {}, gate, recorder)
    await vi.advanceTimersByTimeAsync(5_000)
    releases[0]()
    await first
    await vi.advanceTimersByTimeAsync(10)
    releases[1]()
    await second

    expect(recorder).toHaveBeenCalledTimes(2)
    expect(recorder.mock.calls[1][0].latencyMs).toBeLessThan(100)
  })

  it('adds no outbound request: fetch is called once per gatedFetch call', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response('ok')))

    await gatedFetch('https://example.test/a', {}, newGate(), vi.fn())
    await gatedFetch('https://example.test/b', {}, newGate(), vi.fn())

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
