# Production

Same modules, higher capacity, and every safety setting on:

- RDS multi-AZ, deletion protection on, 35-day backups, final snapshot required
- ECS service autoscaling on CPU and on request count per target
- Two NAT gateways, one per availability zone, so an AZ failure does not take egress with it
- DocumentDB cluster with two instances
- Log retention 90 days, with a KMS key
- Alarm actions wired to a real pager rather than an unsubscribed topic
- Deployment behind a GitHub environment with a required reviewer

**Never applied. No AWS account was ever used, no plan was ever run, and no resource
exists.** This directory holds the intent, not evidence of an operating system.
