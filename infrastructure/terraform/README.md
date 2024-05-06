# Terraform

**Never applied.** No AWS account was used, no `plan` was run, and no resource exists. The build
machine had no Terraform CLI, so this configuration has not even been validated locally. CI runs
`fmt -check` and `validate` on a GitHub-hosted runner.

Saying that plainly matters more than the configuration itself: infrastructure code that has never
been applied is a design document, and presenting it as anything else would be dishonest.

## Layout

```text
modules/
  service/      ECS Fargate service, IAM roles, log group, alarms
  network/      VPC, subnets, security groups, VPC endpoints
  data/         RDS, ElastiCache, DocumentDB
  messaging/    SQS with a dead-letter queue and redrive policy
  storage/      S3 for exports, SSE-KMS, public access blocked
environments/
  dev/          Smallest thing that works. No NAT, no DocumentDB
  staging/      Production shape, lower capacity
  production/   Multi-AZ, autoscaled
```

## Running it

```bash
cd environments/dev
terraform init
terraform plan     # requires credentials. Read DEPLOYMENT.md first
```

`plan` is safe. `apply` creates paid resources and needs explicit approval, which the brief requires
and which has not been given.

## Remote state

S3 with versioning and SSE-KMS, DynamoDB for locking, one state file per environment, separate IAM
roles so a dev apply cannot reach production state. Bootstrapped by a separate configuration with
local state, applied once. That bootstrap is the only place elevated credentials are ever used.

State contains secret values for some resource types. The bucket is encrypted, versioned, has public
access blocked, and access is logged. Secrets themselves are stored in Secrets Manager and referenced
by ARN, so the values are not in the task definition and not in state.

## Conventions

- **No wildcard resources in IAM.** Every statement names what it applies to. The task role can read
  exactly its own secrets, use exactly its own queue, and write to exactly one bucket prefix.
- **Task role and execution role are separate.** The execution role pulls the image and injects
  secrets at start; the task role is what the running process holds. A compromise of the process does
  not also grant image-pull rights.
- **Everything tagged** with project, environment and `Purpose = portfolio-demonstration`, so a
  resource left running by accident is obvious in a cost report.
- **Read-only root filesystem, non-root user** in the container definition.
- **Circuit breaker with rollback** on the service, so a deploy that fails its health check reverts
  without anyone watching.
- **`ignore_changes` on the task definition**, because the image tag moves with each release and is
  the pipeline's business, not Terraform's.

## Cost

Dev is roughly 150 USD a month if built naively; roughly 60 USD with the two changes described in
DEPLOYMENT.md. The two lines that dominate are the NAT gateway and DocumentDB, and both have cheaper
answers for a non-production environment. Those numbers come from the published price list, not from
a bill.
