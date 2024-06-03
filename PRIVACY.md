# Privacy

GuardianLink handles two categories of genuinely sensitive data: where someone is, and who they
depend on. This document says exactly what is collected, why, how long it stays, who can see it, and
how it leaves.

All demo data is synthetic. There is no real personal information anywhere in these repositories,
and the fixture generator is constrained to reserved ranges so none can get in by accident.

## What is collected

| Data | Why | Where it lives | Default retention |
|------|-----|----------------|-------------------|
| Email address | Login and account recovery | Postgres `users` | Life of the account |
| Display name | Shown to operators and contacts during an incident | Postgres `users` | Life of the account |
| Password hash | Authentication | Postgres `users` | Life of the account |
| Trusted contact name, email, phone | To reach them during an incident | Postgres `trusted_contacts` | Until removed, then soft-deleted so past timelines resolve |
| Safety session note and destination | Context for an operator if the session goes overdue | Postgres `safety_sessions` | With the session |
| Incident timeline | Auditability. The record of what happened and who did what | Postgres `incident_events` | 365 days, configurable 30 to 1095 |
| Live location during an incident | The reason the product exists | Postgres `incidents.last_*` and Mongo telemetry | 30 days, configurable 1 to 90 |
| Delivery records | Knowing whether a contact was actually reached | Postgres `notifications` | 90 days, configurable 7 to 365 |
| Audit records | Accountability for privileged access | Postgres `audit_records` | 730 days, not user-configurable |
| Correlation ids | Tracing one request across logs | Logs | Log retention |

**Not collected:** date of birth, address, payment card details (stores handle payment; only an
entitlement is stored), contacts from the device address book, advertising identifiers, background
location outside an incident, or any analytics event by default.

## Who can see what

| Role | Can see |
|------|---------|
| The subject | Everything about themselves |
| A trusted contact | One incident, through a signed link: status, first name, last known position if both sharing switches allow, and whether it has been acknowledged. Nothing else, no history, no other incident |
| An operator | Active incidents and their timelines, including live position while the incident is open. Access is audited |
| An admin | The audit log and account administration. Not incident content |
| Anyone else | Nothing |

The contact view is deliberately thin: first name only, one incident, no profile, no history. A link
sent to a phone gets forwarded, and the payload assumes that will happen.

## Location, specifically

- Accepted only from the subject's own device, and only while an incident is open. An operator
  cannot inject a position.
- Visible only if both the account's `shareLocationWithContacts` setting and that contact's
  `canViewLiveLocation` permission are on. Two independent switches; both must be enabled.
- `storePreciseLocationHistory` is **off by default**. With it off, only a district-level coarsened
  position is retained for analytics; three decimal places, roughly 110 metres, enough to say which
  area an incident happened in and nowhere near enough to identify a home.
- Never written to a log. Latitude and longitude are on the logger's redaction list and there is a
  test asserting it.
- Never written to an audit record. Audit metadata carries field names and identifiers, never values.
- Telemetry carries a TTL index, so expiry is enforced by the database and not only by a job.

## How deletion works

Two-step, with a grace period, because deleting the account holding your incident history should not
be possible by mistyping.

1. The user requests deletion, re-entering their password and typing an exact confirmation phrase.
2. Every session is revoked immediately. If the request came from someone who should not have had
   access, that stops them using the account while it winds down.
3. After 14 days the deletion executes. It can be cancelled at any point before that.

On execution:

- **Removed:** location telemetry, notification records, incidents and their timelines, countdowns,
  safety sessions, trusted contacts, subscription record, privacy settings, refresh tokens.
- **Anonymised:** the user row. Email becomes `deleted+<id>@invalid`, display name becomes
  "Deleted account", password hash is emptied, `deleted_at` is set.
- **Kept:** audit records, with the subject reduced to an identifier that resolves to that tombstone.

Audit records are kept on purpose. They exist so privileged actions stay answerable, and an operator
who viewed someone's location should not be able to erase that by getting the account closed. What
survives is "an operator viewed an incident belonging to user 41f9", never a name, an address, a
phone number or a coordinate. There is a test asserting the record survives and contains no personal
data.

## How export works

`POST /api/v1/privacy/export` returns everything held about the requesting account: profile, privacy
settings, trusted contacts, safety sessions, and every incident with its full timeline and optionally
its location history. JSON, machine-readable, no summarisation.

An integration test asserts the export contains the requester's records and nothing belonging to
anyone else. Export is rate limited to three an hour, which is about making bulk extraction of an
account's history slow and noisy rather than about load. Download links expire after seven days; an
export is the single most sensitive object the system produces and a permanent link eventually leaks.

## How logs avoid sensitive data

The logger redacts by key name at any depth, on both per-call context and inherited bindings, so it
cannot be bypassed by restructuring the call. The list covers password, token, authorization, cookie,
secret, email, phone, latitude, longitude, coordinates, address, name, note and body.

Passing an entire request body to a log call produces a redacted line, not an incident. That is the
design intent: developers log whole objects under pressure, and the safe outcome has to be the
default one.

Identifiers are deliberately not redacted. Keeping `userId`, `incidentId` and `correlationId` is
what makes logs useful without values, so nobody has a reason to reach for the values.

## How demo data stays synthetic

`packages/test-fixtures` generates everything from a seeded PRNG:

- Email addresses use `example.com` and `example.org`, reserved by RFC 2606 and guaranteed to belong
  to nobody.
- Phone numbers use `+1 555 01xx`, the North American fiction range, and `+44 7700 900xxx`, the UK
  Ofcom drama range.
- Coordinates scatter around an invented origin in the North Sea, so no fixture ever points at a real
  home, office or landmark.

Tests assert each of these constraints over hundreds of generated records rather than trusting the
implementation. Seed data ends up in screenshots, and screenshots end up in a portfolio that
strangers read.

## Legal basis

Not applicable. Nothing is deployed and there are no users. A real deployment would need a lawful
basis per purpose, a data-processing agreement with each provider, a retention schedule signed off by
someone qualified, and a documented process for access and erasure requests. The retention defaults
here are engineering guesses, chosen to make the mechanism demonstrable, not legal advice.
