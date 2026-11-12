const MINUTE_MS = 60_000

export function formatLastChecked(lastCheckedAt: number | null, nowMs: number): string {
  if (lastCheckedAt === null) return 'no recent requests'
  const minutes = Math.floor((nowMs - lastCheckedAt) / MINUTE_MS)
  if (minutes < 1) return 'last checked less than 1 min ago'
  return `last checked ${minutes} min ago`
}
