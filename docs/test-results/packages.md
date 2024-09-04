# Recorded package test output

Host: Windows 11, Node v24.11.1
Command: `pnpm -r --filter "./packages/**" test`
Run at: 2026-07-31T09:25:41Z

```console
Scope: 4 of 7 workspace projects
packages/design-tokens test$ vitest run
packages/shared-types test$ vitest run
packages/shared-types test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/agricore-farm-platform/packages/shared-types
packages/design-tokens test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/agricore-farm-platform/packages/design-tokens
packages/shared-types test:  ✓ src/pagination.spec.ts (10 tests) 5ms
packages/design-tokens test:  ✓ src/contrast.spec.ts (42 tests) 9ms
packages/shared-types test:  ✓ src/geo.spec.ts (15 tests) 8ms
packages/design-tokens test:  Test Files  1 passed (1)
packages/design-tokens test:       Tests  42 passed (42)
packages/design-tokens test:    Start at  11:25:43
packages/design-tokens test:    Duration  1.09s (transform 96ms, setup 0ms, collect 103ms, tests 9ms, environment 0ms, prepare 440ms)
packages/shared-types test:  Test Files  2 passed (2)
packages/shared-types test:       Tests  25 passed (25)
packages/shared-types test:    Start at  11:25:43
packages/shared-types test:    Duration  1.11s (transform 156ms, setup 0ms, collect 196ms, tests 13ms, environment 0ms, prepare 1.05s)
packages/design-tokens test: Done
packages/shared-types test: Done
packages/contracts test$ vitest run
packages/contracts test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/agricore-farm-platform/packages/contracts
packages/contracts test:  ✓ src/contracts.spec.ts (38 tests) 14ms
packages/contracts test:  ✓ src/openapi/openapi.spec.ts (27 tests) 12ms
packages/contracts test:  Test Files  2 passed (2)
packages/contracts test:       Tests  65 passed (65)
packages/contracts test:    Start at  11:25:45
packages/contracts test:    Duration  1.04s (transform 290ms, setup 0ms, collect 483ms, tests 25ms, environment 1ms, prepare 524ms)
packages/contracts test: Done
packages/test-fixtures test$ vitest run
packages/test-fixtures test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/agricore-farm-platform/packages/test-fixtures
packages/test-fixtures test:  ✓ src/synthetic.spec.ts (23 tests) 75ms
packages/test-fixtures test:  Test Files  1 passed (1)
packages/test-fixtures test:       Tests  23 passed (23)
packages/test-fixtures test:    Start at  11:25:47
packages/test-fixtures test:    Duration  859ms (transform 96ms, setup 0ms, collect 110ms, tests 75ms, environment 0ms, prepare 245ms)
packages/test-fixtures test: Done
```

Re-recorded after the domain rename, for the reason given in [api.md](api.md).
