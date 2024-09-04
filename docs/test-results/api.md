# Recorded API test output

Host: Windows 11, Node v24.11.1
Command: `npx jest --config jest.config.js --runInBand`
Run at: 2026-07-31T09:24:26Z

Three projects: unit, integration and end-to-end. None needs Postgres, Redis, MongoDB or
AWS credentials.

```console
PASS integration test/integration/authorization.spec.ts (8.11 s)
PASS integration test/integration/graphql.spec.ts
PASS unit src/infrastructure/security/password-hasher.spec.ts (6.872 s)
PASS e2e test/e2e/alert-workflow.e2e.spec.ts
PASS unit src/infrastructure/security/token.service.spec.ts
PASS unit src/domain/alert/alert.spec.ts
PASS unit src/infrastructure/observability/logger.spec.ts
PASS unit src/config/configuration.spec.ts
Test Suites: 8 passed, 8 total
Tests:       137 passed, 137 total
Snapshots:   0 total
Time:        23.532 s, estimated 75 s
Ran all test suites in 3 projects.
```

This transcript is from after the domain rename, and it replaces the earlier one rather than
sitting alongside it. The rename rewrote identifiers inside the old transcript, which would
have left a block of text that no run ever printed. Re-running was the only way to keep this
file what it claims to be.

## Route agreement

The OpenAPI emitter boots the application and compares the generated document against the
routes the router actually registers:

```console
$ npx ts-node -T src/scripts/emit-openapi.ts
wrote C:\Users\slaks\Documents\mygit\agricore-farm-platform\apps\api\generated\openapi.json
document and router agree on all 40 routes
```

On its first run this found four routes the application served and the document did not
describe, and four the document described that did not exist. That is the class of drift a
document generated only from schemas cannot catch, because it is internally consistent and
still wrong.
