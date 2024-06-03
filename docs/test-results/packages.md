# Recorded test output

Host: Windows 11, Node v24.11.1, pnpm 9.15.4
Run at: 2026-07-31T04:31:32Z

## `pnpm -r test` (shared packages)

```console
Scope: 4 of 6 workspace projects
packages/design-tokens test$ vitest run
packages/shared-types test$ vitest run
packages/shared-types test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/shared-types
packages/design-tokens test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/design-tokens
packages/shared-types test:  ✓ src/pagination.spec.ts (10 tests) 12ms
packages/design-tokens test:  ✓ src/contrast.spec.ts (42 tests) 21ms
packages/shared-types test:  ✓ src/geo.spec.ts (15 tests) 9ms
packages/design-tokens test:  Test Files  1 passed (1)
packages/design-tokens test:       Tests  42 passed (42)
packages/design-tokens test:    Start at  06:31:35
packages/design-tokens test:    Duration  2.84s (transform 1.68s, setup 0ms, collect 1.63s, tests 21ms, environment 0ms, prepare 556ms)
packages/shared-types test:  Test Files  2 passed (2)
packages/shared-types test:       Tests  25 passed (25)
packages/shared-types test:    Start at  06:31:35
packages/shared-types test:    Duration  2.87s (transform 1.68s, setup 0ms, collect 3.05s, tests 21ms, environment 0ms, prepare 993ms)
packages/design-tokens test: Done
packages/shared-types test: Done
packages/contracts test$ vitest run
packages/contracts test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/contracts
packages/contracts test:  ✓ src/contracts.spec.ts (38 tests) 17ms
packages/contracts test:  Test Files  1 passed (1)
packages/contracts test:       Tests  38 passed (38)
packages/contracts test:    Start at  06:31:39
packages/contracts test:    Duration  1.07s (transform 175ms, setup 0ms, collect 270ms, tests 17ms, environment 0ms, prepare 267ms)
packages/contracts test: Done
packages/test-fixtures test$ vitest run
packages/test-fixtures test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/test-fixtures
packages/test-fixtures test:  ✓ src/synthetic.spec.ts (23 tests) 105ms
packages/test-fixtures test:  Test Files  1 passed (1)
packages/test-fixtures test:       Tests  23 passed (23)
packages/test-fixtures test:    Start at  06:31:41
packages/test-fixtures test:    Duration  1.10s (transform 148ms, setup 0ms, collect 177ms, tests 105ms, environment 0ms, prepare 263ms)
packages/test-fixtures test: Done
```
