import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Every Playwright waitForFunction call must live inside scripts/lib/verify-settle.ts, with its
// timeout in the options position (args[2]) — see that file's own module doc comment for why:
// the arg position silently swallowing a timeout (page.waitForFunction(fn, { timeout }), which
// Playwright treats as a serialized ARG, not options) is the exact regression this guard exists
// to catch at the source, everywhere in scripts/, not just inside the one file that already
// knows to avoid it. AST-based (ts.createSourceFile + ts.forEachChild), so comment-only prose
// mentions of "waitForFunction" (verify-track-gradient.mts, verify-settle.ts's own doc comments)
// can never trip this — there is nothing to grep, only real CallExpression nodes.

const SCAN_ROOT = 'scripts'
const LIB_FILE = 'scripts/lib/verify-settle.ts'

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkFiles(full, out)
    else if (/\.(mts|ts)$/.test(entry)) out.push(full)
  }
  return out
}

type CallSite = { file: string; line: number; argCount: number; hasTimeoutInOptionsPosition: boolean }

function findWaitForFunctionCalls(file: string): CallSite[] {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const sites: CallSite[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
      const args = node.arguments
      const options = args[2]
      const hasTimeoutInOptionsPosition =
        options !== undefined && ts.isObjectLiteralExpression(options) && options.properties.some((p) => p.name?.getText(source) === 'timeout')

      sites.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        argCount: args.length,
        hasTimeoutInOptionsPosition,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

const callSites = walkFiles(SCAN_ROOT)
  .flatMap(findWaitForFunctionCalls)
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

for (const site of callSites) {
  const location = `${site.file}:${site.line}`
  if (site.file !== LIB_FILE) {
    assert(false, `${location}: waitForFunction call site outside ${LIB_FILE} (args=${site.argCount})`)
    continue
  }
  const hasExactlyThreeArgs = site.argCount === 3
  assert(
    hasExactlyThreeArgs && site.hasTimeoutInOptionsPosition,
    `${location}: waitForFunction has exactly 3 args with a timeout in the options position (args=${site.argCount}, timeout in args[2]=${site.hasTimeoutInOptionsPosition})`,
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s) (${callSites.length} waitForFunction call site(s) scanned)`)
if (failures > 0) process.exit(1)
