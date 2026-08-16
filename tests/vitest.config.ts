import { defineConfig } from 'vitest/config'

// Unit tests cover pure logic only (see unit/README.md). E2E lives in ./e2e and
// is run by Playwright — keep vitest away from those specs.
export default defineConfig({
  test: {
    include: ['unit/**/*.test.ts'],
  },
})
