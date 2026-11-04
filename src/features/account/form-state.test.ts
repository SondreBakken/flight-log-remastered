import { describe, expect, it } from 'vitest'
import { accountFormStateFor } from './account-form-state'
import { pilotIdFormStateFor } from './pilot-id-form-state'

describe('accountFormStateFor', () => {
  it('maps a saved result to success', () => {
    expect(accountFormStateFor({ kind: 'saved' })).toEqual({ status: 'success' })
  })

  it('maps a db-error to a generic message, never the raw database error', () => {
    expect(accountFormStateFor({ kind: 'db-error', message: 'raw database detail' })).toEqual({
      status: 'error',
      message: 'Something went wrong saving your display name. Try again.',
    })
  })
})

describe('pilotIdFormStateFor', () => {
  it('maps a saved result to success', () => {
    expect(pilotIdFormStateFor({ kind: 'saved' })).toEqual({ status: 'success' })
  })

  it('names the actual problem for an invalid pilot id', () => {
    expect(pilotIdFormStateFor({ kind: 'invalid-pilot-id' })).toEqual({
      status: 'error',
      message: "That doesn't look like a flightlog.org pilot id. Check the number on your flightlog.org profile and try again.",
    })
  })

  it('maps a db-error to a generic message, never the raw database error', () => {
    expect(pilotIdFormStateFor({ kind: 'db-error', message: 'raw database detail' })).toEqual({
      status: 'error',
      message: 'Something went wrong saving your flightlog.org pilot id. Try again.',
    })
  })
})
