import { defaultExclude, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Vitest's own defaults (node_modules, .git) don't cover .claude/worktrees/**, where a
    // leftover review worktree carries a full duplicate copy of this repo's test files (not
    // just its node_modules, which the default already excludes) — a stale worktree left by
    // any session would otherwise get picked up by a plain `pnpm test` and fail on drift that
    // has nothing to do with the working tree. Extends defaultExclude rather than replacing it
    // so a future Vitest bump's own default additions aren't silently dropped here.
    exclude: [...defaultExclude, '**/.claude/**'],
    // Without this, a mock's call history survives into the next test. page.test.tsx once
    // had four `not.toHaveBeenCalled()` assertions that only passed because they ran
    // before any test called the mock with a valid case — inserting a valid-case test
    // above them turned all four red.
    clearMocks: true,
  },
})
