import { describe, expect, it, vi } from 'vitest'
import { notifyOwnVerificationChanged, subscribeOwnVerificationChanged } from './own-verification-changed'

describe('own verification changed event', () => {
  it('calls every subscriber on notify', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeOwnVerificationChanged(first)
    const stopSecond = subscribeOwnVerificationChanged(second)

    notifyOwnVerificationChanged()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    stopFirst()
    stopSecond()
  })

  it('stops calling a subscriber once it unsubscribed, leaving the others', () => {
    const stays = vi.fn()
    const leaves = vi.fn()
    const stopStays = subscribeOwnVerificationChanged(stays)
    subscribeOwnVerificationChanged(leaves)()

    notifyOwnVerificationChanged()

    expect(leaves).not.toHaveBeenCalled()
    expect(stays).toHaveBeenCalledTimes(1)
    stopStays()
  })
})
