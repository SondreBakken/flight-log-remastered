export type PilotId = number

// A hostile or corrupted payload could be an arbitrarily long garbage string;
// reject it by length before ever handing it to JSON.parse.
const STORED_RAW_MAX_LENGTH = 20_000

function isValidPilotId(value: unknown): value is PilotId {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function parseStoredIds(raw: string | null): Set<PilotId> {
  if (raw === null || raw.length > STORED_RAW_MAX_LENGTH) return new Set()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Set()
  }

  if (!Array.isArray(parsed)) return new Set()
  return new Set(parsed.filter(isValidPilotId))
}

export function serializeIds(ids: ReadonlySet<PilotId>): string {
  return JSON.stringify([...ids])
}

export function addId(ids: ReadonlySet<PilotId>, id: PilotId): Set<PilotId> {
  const next = new Set(ids)
  if (isValidPilotId(id)) next.add(id)
  return next
}

export function removeId(ids: ReadonlySet<PilotId>, id: PilotId): Set<PilotId> {
  const next = new Set(ids)
  next.delete(id)
  return next
}
