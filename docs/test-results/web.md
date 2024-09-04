# Recorded web test output

Host: Windows 11, Node v24.11.1
Command: `npx vitest run` in apps/web
Run at: 2026-07-31T09:26:22Z

Includes axe accessibility checks over the rendered component tree. Serious and critical
violations fail the test.

```console
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
 RUN  v2.1.9 C:/Users/slaks/Documents/mygit/agricore-farm-platform/apps/web
 ✓ src/lib/alert-view-model.spec.ts (32 tests) 36ms
 ✓ src/components/AlertQueue.test.tsx (16 tests) 501ms
 Test Files  2 passed (2)
      Tests  48 passed (48)
   Start at  11:26:25
   Duration  3.52s (transform 136ms, setup 1.13s, collect 486ms, tests 537ms, environment 2.75s, prepare 415ms)
```

Re-recorded after the domain rename, for the reason given in [api.md](api.md).

## Not executed

Playwright browser journeys. The specs are in `apps/web/e2e`; the browsers (about 400 MB)
were never downloaded on this machine. Run `playwright install chromium` then
`pnpm test:e2e`.
