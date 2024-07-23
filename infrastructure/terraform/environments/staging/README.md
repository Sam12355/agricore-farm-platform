# Staging

Production shape at lower capacity. Differs from `dev/` in exactly the places that matter:

| Setting | dev | staging |
|---------|-----|---------|
| RDS multi-AZ | no | yes |
| Deletion protection | off | on |
| Final snapshot | skipped | taken |
| NAT gateway | none, VPC endpoints only | one |
| DocumentDB | container sidecar | real cluster, single instance |
| Task count | 1 | 2 |
| Log retention | 7 days | 30 days |

Not written out as a separate configuration here: it is `dev/main.tf` with those variables
changed, and duplicating four hundred lines to change eight values is how environments
drift apart. The real answer is a shared module with per-environment tfvars, which is what
`modules/service` exists for.

**Never applied.** See DEPLOYMENT.md.
