// @vitest-environment node
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// The backfill runs as a plain Node process under tsx, where 'server-only' throws on import and
// next/* is not set up. Bundling the script's whole local import graph (packages stay external,
// so they show up as bare specifiers) turns a stray server-only import into a CI failure instead
// of a crash during the owner's prod run.
async function bundledImportSpecifiers(entry: string): Promise<string[]> {
  const { metafile } = await build({
    entryPoints: [entry],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  const externalImports = Object.values(metafile.outputs).flatMap((output) => output.imports.map((imported) => imported.path))
  return [...new Set(externalImports)]
}

describe('scripts/backfill-follow-names.mts', () => {
  it('imports no server-only or next/* module anywhere in its import graph', async () => {
    const specifiers = await bundledImportSpecifiers('scripts/backfill-follow-names.mts')

    // Guards against a vacuous pass: an empty list would mean the bundle saw nothing.
    expect(specifiers).toContain('drizzle-orm/node-postgres')
    expect(specifiers.filter((path) => path === 'server-only' || path === 'next' || path.startsWith('next/'))).toEqual([])
  })
})
