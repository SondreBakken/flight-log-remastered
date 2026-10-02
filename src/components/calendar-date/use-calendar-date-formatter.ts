'use client'

import { useSyncExternalStore } from 'react'
import { formatCalendarDate } from '@/lib/text/format-calendar-date'

// The viewer's locale is only known in the browser. Reading Accept-Language via headers() would
// turn every prerendered page under cacheComponents into a request-time render, so the server
// (and the hydration pass) renders the raw ISO date and the browser swaps in the locale format.
export function useCalendarDateFormatter(): (value: string) => string {
  const locale = useSyncExternalStore(subscribeToLanguageChange, readBrowserLocale, readNoLocale)
  return (value) => (locale === null ? value : formatCalendarDate(value, locale))
}

function subscribeToLanguageChange(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange)
  return () => window.removeEventListener('languagechange', onChange)
}

function readBrowserLocale(): string | null {
  return navigator.language
}

function readNoLocale(): string | null {
  return null
}
