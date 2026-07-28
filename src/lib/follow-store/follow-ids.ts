import { isValidPilotId, type PilotId } from '@/lib/flightlog/types'

export type { PilotId }

// A hostile or corrupted payload could be an arbitrarily long garbage string;
// reject it by length before ever handing it to JSON.parse. Exported so storage.ts
// can apply the same limit on write, and the check script can build a payload that
// exercises it precisely.
export const STORED_RAW_MAX_LENGTH = 20_000

// A raw stored value can fail to represent a followed-ids list at all: structurally (corrupted
// JSON, wrong shape, over length) or by content (a non-empty array none of whose elements is a
// valid id — the shape a serializer change or a schema drift produces, e.g. ids stringified or
// nested one level). Both are indistinguishable from data loss if treated as "the user follows
// nobody", so both are a failed read, not a valid-but-empty one. Callers need to tell a failed
// read apart from a genuinely empty list ("[]"), so it carries no ids rather than collapsing
// into one — each caller decides for itself what "failed to read" should mean for it.
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

  const ids = parsed.filter(isValidPilotId)
  // A non-empty array where every element fails id validation is corruption, not "follows
  // nobody" — see the type doc above. An empty array has no elements to fail, so it is
  // unaffected and still succeeds with an empty set.
  if (parsed.length > 0 && ids.length === 0) return { ok: false }
  return { ok: true, ids: new Set(ids) }
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
