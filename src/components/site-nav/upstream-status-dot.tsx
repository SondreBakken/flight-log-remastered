'use client'

import { useCallback, useEffect, useState } from 'react'
import type { UpstreamState, UpstreamStatus } from '@/lib/flightlog/upstream-status'
import { fetchUpstreamStatus } from './fetch-upstream-status'
import { formatLastChecked } from './format-last-checked'

const UNKNOWN_STATUS: UpstreamStatus = { state: 'unknown', lastCheckedAt: null }

const STATE_WORDS: Record<UpstreamState, string> = {
  up: 'flightlog.org is up',
  slow: 'flightlog.org is slow',
  down: 'flightlog.org is down',
  unknown: 'flightlog.org status unknown',
}

const STATE_COLOR_CLASSES: Record<UpstreamState, string> = {
  up: 'bg-green-500',
  slow: 'bg-amber-500',
  down: 'bg-red-500',
  unknown: 'bg-gray-400',
}

// Read from a route handler after mount (and again on hover or focus), so the root layout stays
// prerendered. The route reads an in-memory window and makes no flightlog.org request; a failed
// read shows unknown.
export default function UpstreamStatusDot() {
  const [status, setStatus] = useState<UpstreamStatus>(UNKNOWN_STATUS)
  const [isOpen, setIsOpen] = useState(false)
  const [nowMs, setNowMs] = useState(0)

  const refresh = useCallback(() => {
    fetchUpstreamStatus()
      .then((next) => {
        setStatus(next)
        setNowMs(Date.now())
      })
      .catch((error: unknown) => {
        console.error('[site-nav] failed to load flightlog.org status:', error)
        setStatus(UNKNOWN_STATUS)
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function open() {
    refresh()
    setIsOpen(true)
  }

  const text = `${STATE_WORDS[status.state]}, ${formatLastChecked(status.lastCheckedAt, nowMs)}`

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={text}
        className="flex h-5 w-5 items-center justify-center rounded-full"
        onClick={open}
        onMouseEnter={open}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={open}
        onBlur={() => setIsOpen(false)}
      >
        <span data-testid="upstream-status-dot" className={`h-2.5 w-2.5 rounded-full ${STATE_COLOR_CLASSES[status.state]}`} />
      </button>
      {isOpen && (
        <span role="status" className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded border border-rule bg-paper px-2 py-1 text-xs">
          {text}
        </span>
      )}
    </span>
  )
}
