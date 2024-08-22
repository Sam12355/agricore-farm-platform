# Recorded package test output

Host: Windows 11, Node v24.11.1
Command: `pnpm -r --filter "./packages/**" test`
Run at: 2026-07-31T08:39:56Z

```console
Scope: 4 of 7 workspace projects
packages/design-tokens test$ vitest run
packages/shared-types test$ vitest run
packages/design-tokens test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/design-tokens
packages/shared-types test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/shared-types
packages/shared-types test:  ✓ src/pagination.spec.ts (10 tests) 5ms
packages/design-tokens test:  ✓ src/contrast.spec.ts (42 tests) 41ms
packages/design-tokens test:  Test Files  1 passed (1)
packages/design-tokens test:       Tests  42 passed (42)
packages/design-tokens test:    Start at  10:39:59
packages/design-tokens test:    Duration  3.15s (transform 1.93s, setup 0ms, collect 1.97s, tests 41ms, environment 0ms, prepare 523ms)
packages/shared-types test:  ✓ src/geo.spec.ts (15 tests) 36ms
packages/shared-types test:  Test Files  2 passed (2)
packages/shared-types test:       Tests  25 passed (25)
packages/shared-types test:    Start at  10:39:59
packages/shared-types test:    Duration  3.34s (transform 3.82s, setup 0ms, collect 4.02s, tests 41ms, environment 1ms, prepare 879ms)
packages/design-tokens test: Done
packages/shared-types test: Done
packages/contracts test$ vitest run
packages/contracts test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/contracts
packages/contracts test:  ✓ src/contracts.spec.ts (38 tests) 14ms
packages/contracts test:  ✓ src/openapi/openapi.spec.ts (27 tests) 12ms
packages/contracts test:  Test Files  2 passed (2)
packages/contracts test:       Tests  65 passed (65)
packages/contracts test:    Start at  10:40:04
packages/contracts test:    Duration  1.09s (transform 369ms, setup 0ms, collect 633ms, tests 26ms, environment 1ms, prepare 535ms)
packages/contracts test: Done
packages/test-fixtures test$ vitest run
packages/test-fixtures test:  RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/packages/test-fixtures
packages/test-fixtures test:  ✓ src/synthetic.spec.ts (23 tests) 84ms
packages/test-fixtures test:  Test Files  1 passed (1)
packages/test-fixtures test:       Tests  23 passed (23)
packages/test-fixtures test:    Start at  10:40:06
packages/test-fixtures test:    Duration  853ms (transform 97ms, setup 0ms, collect 113ms, tests 84ms, environment 0ms, prepare 240ms)
packages/test-fixtures test: Done
```
