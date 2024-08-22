# Recorded API test output

Host: Windows 11, Node v24.11.1
Command: `npx jest --config jest.config.js --runInBand`
Run at: 2026-07-31T08:37:28Z

Three projects: unit, integration and end-to-end. None needs Postgres, Redis, MongoDB or
AWS credentials.

```console
PASS unit src/infrastructure/security/password-hasher.spec.ts (34.156 s)
PASS integration test/integration/graphql.spec.ts (40.739 s)
PASS e2e test/e2e/sos-workflow.e2e.spec.ts (24.641 s)
PASS integration test/integration/authorization.spec.ts (12.855 s)
PASS unit src/infrastructure/security/token.service.spec.ts
PASS unit src/config/configuration.spec.ts
PASS unit src/domain/incident/incident.spec.ts
PASS unit src/infrastructure/observability/logger.spec.ts
Test Suites: 8 passed, 8 total
Tests:       137 passed, 137 total
Snapshots:   0 total
Time:        117.284 s
Ran all test suites in 3 projects.
```

## Route agreement

The OpenAPI emitter boots the application and compares the generated document against the
routes the router actually registers:

```console
$ npx ts-node -T src/scripts/emit-openapi.ts
wrote C:\Users\slaks\Documents\mygit\guardianlink-platform\apps\api\generated\openapi.json
document and router agree on all 40 routes
```

On its first run this found four routes the application served and the document did not
describe, and four the document described that did not exist. That is the class of drift a
document generated only from schemas cannot catch, because it is internally consistent and
still wrong.
