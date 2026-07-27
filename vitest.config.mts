import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Without this, a mock's call history survives into the next test. page.test.tsx once
    // had four `not.toHaveBeenCalled()` assertions that only passed because they ran
    // before any test called the mock with a valid case — inserting a valid-case test
    // above them turned all four red.
    clearMocks: true,
  },
})
