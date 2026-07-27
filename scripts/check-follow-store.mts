import { addId, parseStoredIds, removeId, serializeIds } from '../src/lib/follow-store/follow-ids'

let failures = 0

function idsOf(ids: ReadonlySet<number>): number[] {
  return [...ids].sort((a, b) => a - b)
}

function assertEqual(actual: number[], expected: number[], label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

// Round-trip
assertEqual(
  idsOf(parseStoredIds(serializeIds(new Set([12677, 4549])))),
  [4549, 12677],
  'round-trips a valid id set through serialize/parse',
)

// Dedupe
assertEqual(idsOf(addId(addId(new Set(), 5), 5)), [5], 'adding the same id twice dedupes')
assertEqual(
  idsOf(parseStoredIds('[5, 5, 7]')),
  [5, 7],
  'duplicate ids in stored JSON dedupe on parse',
)

// Add / remove
assertEqual(idsOf(addId(new Set([1]), 2)), [1, 2], 'add appends a new id')
assertEqual(idsOf(removeId(new Set([1, 2]), 1)), [2], 'remove drops an id')
assertEqual(idsOf(removeId(new Set([1]), 999)), [1], 'removing an absent id is a no-op')

// Malformed / hostile input to parseStoredIds
assertEqual(idsOf(parseStoredIds(null)), [], 'null raw value parses to empty set')
assertEqual(idsOf(parseStoredIds('not json')), [], 'invalid JSON parses to empty set')
assertEqual(idsOf(parseStoredIds('{"not":"an array"}')), [], 'non-array JSON object parses to empty set')
assertEqual(idsOf(parseStoredIds('"just a string"')), [], 'JSON string (non-array) parses to empty set')
assertEqual(idsOf(parseStoredIds('42')), [], 'JSON number (non-array) parses to empty set')
assertEqual(idsOf(parseStoredIds('[1.5, 2]')), [2], 'non-integer ids are dropped')
assertEqual(idsOf(parseStoredIds('[-1, 2]')), [2], 'negative ids are dropped')
assertEqual(idsOf(parseStoredIds('[0, 2]')), [2], 'zero is dropped (not a valid pilot id)')
assertEqual(idsOf(parseStoredIds('[NaN, 2]')), [], 'NaN is not valid JSON, so the whole payload is rejected')
assertEqual(
  idsOf(parseStoredIds('[1, "two", null, 3, {}, [], true]')),
  [1, 3],
  'mixed-type array keeps only valid integer ids',
)
assertEqual(
  idsOf(parseStoredIds('x'.repeat(25_000))),
  [],
  'a raw string past the length guard is rejected without being parsed',
)

// Malformed / hostile input to addId itself, not just at parse time
assertEqual(idsOf(addId(new Set([1]), -5)), [1], 'addId rejects a negative id')
assertEqual(idsOf(addId(new Set([1]), 2.5)), [1], 'addId rejects a non-integer id')
assertEqual(idsOf(addId(new Set([1]), 0)), [1], 'addId rejects zero')
assertEqual(idsOf(addId(new Set([1]), Number.NaN)), [1], 'addId rejects NaN')

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
