# Recorded web test output

Host: Windows 11, Node v24.11.1
Command: `npx vitest run` in apps/web
Run at: 2026-07-31T08:40:07Z

Includes axe accessibility checks over the rendered component tree. Serious and critical
violations fail the test.

```console
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
 RUN  v2.1.9 C:/Users/slaks/Documents/mygit/guardianlink-platform/apps/web
 ✓ src/lib/incident-view-model.spec.ts (32 tests) 180ms
 ✓ src/components/IncidentQueue.test.tsx (16 tests) 1609ms
   ✓ IncidentQueue > renders one option per incident 333ms
   ✓ IncidentQueue > keyboard operation > does not wrap past the end 371ms
 Test Files  2 passed (2)
      Tests  48 passed (48)
   Start at  10:40:10
   Duration  9.58s (transform 592ms, setup 6.50s, collect 2.41s, tests 1.79s, environment 3.88s, prepare 426ms)
```

## Not executed

Playwright browser journeys. The specs are in `apps/web/e2e`; the browsers (about 400 MB)
were never downloaded on this machine. Run `playwright install chromium` then
`pnpm test:e2e`.
