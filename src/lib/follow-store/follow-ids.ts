export type PilotId = number

// A hostile or corrupted payload could be an arbitrarily long garbage string;
// reject it by length before ever handing it to JSON.parse. Exported so storage.ts
// can apply the same limit on write, and the check script can build a payload that
// exercises it precisely.
export const STORED_RAW_MAX_LENGTH = 20_000

function isValidPilotId(value: unknown): value is PilotId {
  // isSafeInteger, not isInteger: values past 2^53 (e.g. from `1e308` or an
  // over-precision literal in the stored JSON) still pass isInteger after float
  // coercion but are not real ids.
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// A raw stored value can fail to represent a followed-ids list at all (corrupted JSON, wrong
// shape, over length) as opposed to correctly representing an empty one ("[]"). Callers need
// to tell these apart, so a failed read carries no ids rather than collapsing into one — each
// caller decides for itself what "failed to read" should mean for it.
export type StoredIdsRead = { readonly ok: true; readonly ids: Set<PilotId> } | { readonly ok: false }

export function parseStoredIds(raw: string | null): StoredIdsRead {
  if (raw === null || raw.length > STORED_RAW_MAX_LENGTH) return { ok: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }

  if (!Array.isArray(parsed)) return { ok: false }
  return { ok: true, ids: new Set(parsed.filter(isValidPilotId)) }
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
