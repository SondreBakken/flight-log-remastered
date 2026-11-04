// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = join(import.meta.dirname, '..', '..')
const COMMENTS_UPDATE = /\.update\(\s*comments\b|\bupdate\s+(public\.)?comments\b/i

async function findSourceFiles(): Promise<string[]> {
  const entries = await readdir(SOURCE_ROOT, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

// Former RLS rule: comments had no update policy, so the only change a comment could ever get was
// soft_delete_own_comment setting deleted_at. With the server as the only database client, that
// rule now holds only as long as no app code writes an UPDATE against comments.
describe('comment updates', () => {
  it('happen nowhere in app code; soft_delete_own_comment is the only write after insert', async () => {
    const files = await findSourceFiles()
    const filesUpdatingComments: string[] = []
    for (const file of files) {
      if (COMMENTS_UPDATE.test(await readFile(file, 'utf8'))) filesUpdatingComments.push(relative(SOURCE_ROOT, file))
    }

    expect(files.length).toBeGreaterThan(0)
    expect(filesUpdatingComments).toEqual([])
  })
})
