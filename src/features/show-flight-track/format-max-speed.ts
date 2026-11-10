import type { MaxSpeedKind } from '@/lib/flightlog/types'
import { formatAltitude } from './format-altitude'

const SPEED_PAIR = /^(\d+(?:\.\d+)?)\s*(?:km\/h)?\s*\/\s*(\d+(?:\.\d+)?)\s*km\/h$/

const PAIR_LABELS: Record<MaxSpeedKind, [string, string]> = {
  '10s/60s': ['10 s', '60 s'],
  'mean/top': ['mean', 'top'],
}

// Labels both numbers of the KML's speed pair with the interval or role the exporter meant.
// Anything that is not a recognisable pair, or has no known kind, is shown raw rather than guessed at.
export function formatMaxSpeed(raw: string | null, kind: MaxSpeedKind | null): string {
  // formatAltitude(null) is the shared null placeholder.
  if (raw === null) return formatAltitude(null)
  const match = raw.match(SPEED_PAIR)
  if (!match || kind === null) return raw
  const [first, second] = PAIR_LABELS[kind]
  return `${match[1]} km/h (${first}) / ${match[2]} km/h (${second})`
}
