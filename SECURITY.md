# Security

GuardianLink is a portfolio demonstration and is not deployed anywhere. There is no production
system to attack and no real user data to lose. This document describes the controls that are
implemented, the ones that are deliberately absent, and how to report a problem.

## Reporting

Open a GitHub issue. Do not include a real credential, a real access token, or real location data
in it. If you believe you have found something that would matter in a real deployment, say so in
the title and I will treat it as a design review rather than an incident, because there is nothing
live to be compromised.

## What is implemented

### Authentication

- Passwords hashed with scrypt at the OWASP-minimum parameters (N=2^17, r=8, p=1), salted per
  password, compared in constant time. Parameters are stored with the hash so the cost can be
  raised later, and `needsRehash` upgrades a stored hash on the next successful login.
- Password policy follows NIST 800-63B: length matters, composition rules do not. A twelve-character
  minimum, no forced symbol classes.
- Access tokens are short-lived HS256 JWTs carrying only a subject, a role and a family identifier.
  Nothing that identifies a person is in there, because tokens end up in logs and crash reports.
- The verify call pins `algorithms: ['HS256']`, plus issuer and audience. Without that pin, a token
  claiming `alg: none` is accepted. There is a test for it.
- Refresh tokens are opaque 32-byte random strings, stored only as a SHA-256 hash. A database dump
  does not hand anyone a working session.
- Refresh tokens are single-use and rotate on every exchange. Presenting one twice revokes the
  entire token family, because a replay and a theft are indistinguishable from the server side.

### Authorisation

- Route guards answer "are you authenticated and could your role possibly do this".
- Ownership is checked separately, in the service layer, because only it can load the record. Both
  layers are required; a route-only check is how "any logged-in user can read any incident by
  guessing an id" happens.
- Reading something that exists but is not yours returns 404, not 403. A 403 confirms the resource
  exists, which is an enumeration oracle.
- Operator actions require an operator role and, for anything that changes an incident, a live claim.
- Socket subscriptions are authorised per room, with the same ownership rule, not only at connect.

### Input and output

- Every request body and query is validated against a Zod schema from `packages/contracts`, which is
  also the source of the published types and the OpenAPI document, so the validator cannot drift from
  the contract.
- Length caps on every free-text field, so a client cannot post a megabyte into a text column.
- Responses go through explicit DTO mappers rather than returning the persisted record. Internal
  fields cannot leak by being added to a table.
- One error envelope everywhere, with a correlation id. Unexpected exceptions are logged with detail
  and answered with a generic message.

### Rate limiting

Per route and per subject, or per address on unauthenticated routes. Tighter on the expensive and
sensitive paths: three data exports an hour, twenty contact-link acknowledgements a minute. `429`
always carries `Retry-After`, because without it a mobile client hammers the endpoint.

### Idempotency

Mandatory on SOS activation. Enforced at the HTTP layer against a stored response, and again at the
database with a unique index on `(user_id, key)`. The same key with a different body is a 409, not a
silent success: that combination is always a client bug and hiding it helps nobody.

### Transport and headers

Helmet with a restrictive CSP, `frame-ancestors 'none'`, `no-referrer`, and HSTS in production. CORS
is an explicit allow-list, never a wildcard, with `Idempotency-Key` and the correlation header
declared so a browser preflight does not silently strip them.

### Logging and audit

- The logger redacts by key name at any depth: password, token, authorization, cookie, email, phone,
  latitude, longitude, address, name, note, body. Passing a whole request body to a log call produces
  a redacted line rather than an incident. There are tests for this.
- Coordinates are on the redaction list deliberately, and it is the entry I would defend hardest.
  Coordinates in a log sink are retained for as long as the log group lives, readable by anyone with
  logs access, and outside every retention control the product offers.
- Audit records hold identifiers and field names, never values. The table outlives every retention
  setting in the product, so anything sensitive in it is effectively permanent.
- Correlation ids from callers are only trusted if they are short and url-safe. A newline in one
  splits a log line in two.

### Secrets

- Nothing in the working tree. `.gitignore` covers keys, certificates, keystores, provisioning
  profiles and service-account JSON.
- `.env.example` carries placeholders only.
- The config schema rejects secrets under 32 characters, rejects obvious placeholders like
  `changeme`, and rejects reuse of one secret across token types.
- CI runs gitleaks over full history, because a secret committed and later removed still leaked.

### Data protection

- Location is accepted only from the subject, only while the incident is open. An operator cannot
  inject a position, so every point on the map came from the device that was there.
- Sharing is two independent switches: the subject's privacy setting and the per-contact permission.
  Both must be on.
- Contact-view tokens name one incident and one contact, expire, and carry no role or user id. The
  worst a leaked link can do is show one incident to someone already entitled to see it.
- Precise location history is off by default. When disabled, only district-level coarsened positions
  are retained.

## What is deliberately not implemented

Being explicit about this matters more than the list of what is.

- **No multi-factor authentication.** A real safety product needs it. It is not here.
- **No breached-password check.** Listed as roadmap work.
- **No account lockout.** Rate limiting only. Lockout is a denial-of-service vector against the
  account it protects, and getting the balance right needs data I do not have.
- **No certificate pinning in the mobile apps.** Correct for a real deployment, disproportionate
  here, and it makes local development against a proxy painful.
- **No WAF, no bot detection, no fraud scoring.** Infrastructure concerns for a system that is
  actually deployed.
- **No penetration test.** Nothing here has been tested by anyone but me, and no scan output is
  presented as if it had been.

## Verification status

| Control | Verified how |
|---------|--------------|
| Password hashing, salting, rehash policy | Unit tests, recorded output |
| JWT algorithm pinning, audience, issuer, expiry | Unit tests including a forged `alg: none` token |
| Refresh rotation and reuse detection | Integration tests |
| Cross-user authorisation on every incident and contact operation | Integration tests |
| Log redaction | Unit tests asserting the emitted line |
| Idempotency and duplicate suppression | End-to-end tests |
| Rate limiting | Implemented; covered by unit tests of the limiter, not by an end-to-end burst test |
| Secret scanning | CI job configured, not executed on the build machine |
| Dependency audit | CI job configured, not executed on the build machine |
| Helmet and CORS headers | Implemented; not asserted by a test |

Recorded output is in [docs/test-results/](docs/test-results/). Anything not listed as verified was
not run, and is not claimed.
