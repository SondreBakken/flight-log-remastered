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
//
// The options check requires a literal `timeout` property on the object literal in args[2] by
// design: a spread ({ ...opts }) or a computed key ({ [key]: value }) is rejected even when it
// would set the timeout correctly at runtime, because the point of this guard is that the
// timeout is literally visible at the call site, not merely present somewhere upstream.
//
// This AST match has known blind spots, accepted because the threat model here is an in-place
// tidy-up of scripts/, not deliberate evasion: an aliased call (const w = page.waitForFunction;
// w(...)) or an element-access call (page['waitForFunction'](...)) is not detected. Matching on
// the method name alone, regardless of receiver, is intentional rather than an oversight — it
// is what also catches frame.waitForFunction, which carries the same argument-position trap as
// page.waitForFunction, so this must not later be narrowed to only Page.

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

let callSites: CallSite[]
try {
  callSites = walkFiles(SCAN_ROOT)
    .flatMap(findWaitForFunctionCalls)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
} catch (error) {
  assert(false, `${SCAN_ROOT}: scan root missing or unreadable (${error instanceof Error ? error.message : String(error)})`)
  console.log(`\nFAIL - ${failures} failure(s) (0 waitForFunction call site(s) scanned)`)
  process.exit(1)
}

// If the lib's wrappers ever stop calling waitForFunction (renamed, refactored away, or the
// file moved), callSites for LIB_FILE goes to zero and the loop below has nothing left to
// fail — a silent, vacuous PASS with zero real assertions. This keeps that failure mode loud.
assert(
  callSites.some((site) => site.file === LIB_FILE),
  `${LIB_FILE} still contains the wrappers this guard exists to check`,
)

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
