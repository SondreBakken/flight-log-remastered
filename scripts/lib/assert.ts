// Shared by scripts that otherwise each hand-roll the same "call it, expect a throw" try/catch —
// takes the caller's own `assert(condition, label)` so it reports through that script's existing
// ok/FAIL log and failure counter, rather than introducing a second reporting path.
export async function assertRejects(
  assert: (condition: boolean, label: string) => void,
  thunk: () => Promise<unknown>,
  label: string,
): Promise<void> {
  let threw = false
  try {
    await thunk()
  } catch {
    threw = true
  }
  assert(threw, label)
}
