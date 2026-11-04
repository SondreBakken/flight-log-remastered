// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase, createTestUser } from './test-database'

let client: PGlite

beforeAll(async () => {
  ;({ client } = await createTestDatabase())
})

afterAll(async () => {
  await client.close()
})

function createUser(): Promise<string> {
  return createTestUser(client)
}

async function createLinkedPilot(pilotId: number): Promise<string> {
  const userId = await createUser()
  await client.query('insert into profiles (user_id, flightlog_pilot_id) values ($1, $2)', [userId, pilotId])
  return userId
}

async function issueVerification(userId: string, code: string): Promise<number> {
  const { rows } = await client.query<{ pilot_id: number }>(
    'select issue_pilot_verification($1, $2, $3) as pilot_id',
    [userId, 'pilot@example.test', code],
  )
  return rows[0].pilot_id
}

async function confirmVerification(userId: string, code: string): Promise<boolean> {
  const { rows } = await client.query<{ confirmed: boolean }>(
    'select confirm_pilot_verification($1, $2) as confirmed',
    [userId, code],
  )
  return rows[0].confirmed
}

async function expireIssuanceCooldown(userId: string): Promise<void> {
  await client.query(
    `update profile_verification_issuance set last_issued_at = now() - interval '61 seconds' where user_id = $1`,
    [userId],
  )
}

async function findVerification(userId: string) {
  const { rows } = await client.query<{ status: string; failed_attempts: number }>(
    'select status, failed_attempts from profile_verifications where user_id = $1',
    [userId],
  )
  return rows[0]
}

async function isPilotVerified(pilotId: number): Promise<boolean> {
  const { rows } = await client.query<{ verified: boolean }>('select is_pilot_verified($1) as verified', [pilotId])
  return rows[0].verified
}

describe('issue_pilot_verification', () => {
  it('returns the linked pilot id and stores a pending verification', async () => {
    const userId = await createLinkedPilot(1001)

    expect(await issueVerification(userId, '123456')).toBe(1001)
    expect(await findVerification(userId)).toEqual({ status: 'pending', failed_attempts: 0 })
  })

  it('raises P0001 for a user with no linked pilot id', async () => {
    const userId = await createUser()

    await expect(issueVerification(userId, '123456')).rejects.toMatchObject({ code: 'P0001' })
  })

  it('raises RL001 when re-issued inside the 60 second cooldown, and allows it after', async () => {
    const userId = await createLinkedPilot(1002)
    await issueVerification(userId, '111111')

    await expect(issueVerification(userId, '222222')).rejects.toMatchObject({ code: 'RL001' })

    await expireIssuanceCooldown(userId)
    await expect(issueVerification(userId, '222222')).resolves.toBe(1002)
  })

  it('resets failed_attempts when a fresh code is issued', async () => {
    const userId = await createLinkedPilot(1003)
    await issueVerification(userId, '111111')
    await confirmVerification(userId, '000000')
    await confirmVerification(userId, '000000')
    expect((await findVerification(userId)).failed_attempts).toBe(2)

    await expireIssuanceCooldown(userId)
    await issueVerification(userId, '222222')

    expect(await findVerification(userId)).toEqual({ status: 'pending', failed_attempts: 0 })
  })
})

describe('confirm_pilot_verification', () => {
  it('verifies the given user with the correct code and rejects a replay', async () => {
    const userId = await createLinkedPilot(2001)
    await issueVerification(userId, '123456')

    expect(await confirmVerification(userId, '123456')).toBe(true)
    expect((await findVerification(userId)).status).toBe('verified')
    expect(await confirmVerification(userId, '123456')).toBe(false)
  })

  it("does not confirm another user's code", async () => {
    const ownerId = await createLinkedPilot(2002)
    const otherId = await createLinkedPilot(2003)
    await issueVerification(ownerId, '123456')

    expect(await confirmVerification(otherId, '123456')).toBe(false)
    expect((await findVerification(ownerId)).status).toBe('pending')
  })

  it('locks out after 5 failed attempts with AL001, even for the correct code', async () => {
    const userId = await createLinkedPilot(2004)
    await issueVerification(userId, '123456')

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await confirmVerification(userId, '000000')).toBe(false)
    }

    await expect(confirmVerification(userId, '123456')).rejects.toMatchObject({ code: 'AL001' })
    expect(await findVerification(userId)).toEqual({ status: 'pending', failed_attempts: 5 })
  })
})

describe('soft_delete_own_comment', () => {
  async function postComment(userId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into comments (user_id, trip_id, body) values ($1, 1, 'Nice flight') returning id`,
      [userId],
    )
    return rows[0].id
  }

  async function softDeleteComment(userId: string, commentId: string): Promise<boolean> {
    const { rows } = await client.query<{ deleted: boolean }>(
      'select soft_delete_own_comment($1, $2) as deleted',
      [userId, commentId],
    )
    return rows[0].deleted
  }

  it("soft-deletes only the given user's own comment, once", async () => {
    const authorId = await createUser()
    const otherId = await createUser()
    const commentId = await postComment(authorId)

    expect(await softDeleteComment(otherId, commentId)).toBe(false)
    expect(await softDeleteComment(authorId, commentId)).toBe(true)
    expect(await softDeleteComment(authorId, commentId)).toBe(false)

    const { rows } = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from comments where id = $1',
      [commentId],
    )
    expect(rows[0].deleted_at).not.toBeNull()
  })
})

describe('is_pilot_verified', () => {
  it('is true only once a verification for that pilot id is confirmed', async () => {
    const userId = await createLinkedPilot(3001)
    expect(await isPilotVerified(3001)).toBe(false)

    await issueVerification(userId, '123456')
    expect(await isPilotVerified(3001)).toBe(false)

    await confirmVerification(userId, '123456')
    expect(await isPilotVerified(3001)).toBe(true)
  })
})

describe('invalidate_verification_on_pilot_id_change trigger', () => {
  it('deletes the verification when the profile pilot id changes', async () => {
    const userId = await createLinkedPilot(4001)
    await issueVerification(userId, '123456')
    await confirmVerification(userId, '123456')

    await client.query('update profiles set flightlog_pilot_id = 4002 where user_id = $1', [userId])

    expect(await findVerification(userId)).toBeUndefined()
    expect(await isPilotVerified(4001)).toBe(false)
  })

  it('keeps the verification when another profile column changes', async () => {
    const userId = await createLinkedPilot(4003)
    await issueVerification(userId, '123456')

    await client.query(`update profiles set display_name = 'Renamed' where user_id = $1`, [userId])

    expect((await findVerification(userId)).status).toBe('pending')
  })
})
