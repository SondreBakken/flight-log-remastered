import type { UpdateDisplayNameResult } from '@/lib/profiles/update-display-name'

export type AccountFormState = { status: 'idle' } | { status: 'error'; message: string } | { status: 'success' }

const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your display name. Try again.'

// A pure mapping from the business-logic result to what the form shows — split out of
// actions.ts for the same reason as comment-form-state.ts: a file carrying the 'use server'
// directive may only export async Server Functions, so this stays a plain sync function,
// importable directly by both actions.ts and scripts/check-profiles.mts.
export function accountFormStateFor(result: UpdateDisplayNameResult): AccountFormState {
  switch (result.kind) {
    case 'saved':
      return { status: 'success' }
    case 'db-error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }
}
