/**
 * Development environment.
 *
 * NEVER APPLIED. No AWS account was used and no resource exists. See DEPLOYMENT.md.
 *
 * Sized to be the cheapest thing that still exercises the real architecture. Two
 * decisions dominate the bill and both are made differently here than in production:
 *
 *   1. No NAT gateway. It costs more per month than the compute it serves. VPC endpoints
 *      for S3 and SQS cover what the task actually needs to reach.
 *   2. No DocumentDB. Its smallest instance class costs more than everything else here
 *      combined, so dev runs MongoDB as a sidecar container. The port is the same either
 *      way, which is the whole reason that substitution is possible.
 *
 * Together those take the environment from roughly 150 USD a month to roughly 60.
 */

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Commented out so `terraform init -backend=false` works in CI with no credentials,
  # which is what lets validation run on every pull request. Uncomment for real use; the
  # bucket and lock table are created by the bootstrap configuration.
  #
  # backend "s3" {
  #   bucket         = "guardianlink-tfstate"
  #   key            = "dev/terraform.tfstate"
  #   region         = "eu-west-1"
  #   dynamodb_table = "guardianlink-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "guardianlink"
      Environment = "dev"
      ManagedBy   = "terraform"
      # Every resource carries this. A demonstration left running by accident should be
      # obvious in a cost report rather than hiding in a line item.
      Purpose = "portfolio-demonstration"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "guardianlink-dev"
}

# --- Networking ------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = local.name }
}

resource "aws_subnet" "private" {
  for_each = { a = "10.20.1.0/24", b = "10.20.2.0/24" }

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = "${var.region}${each.key}"

  tags = { Name = "${local.name}-private-${each.key}" }
}

resource "aws_subnet" "public" {
  for_each = { a = "10.20.101.0/24", b = "10.20.102.0/24" }

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value
  availability_zone       = "${var.region}${each.key}"
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${each.key}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# VPC endpoints instead of a NAT gateway. Gateway endpoints for S3 and DynamoDB are free;
# together with an interface endpoint for SQS they cover everything the task reaches.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
}

resource "aws_vpc_endpoint" "sqs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.sqs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
}

# --- Security groups --------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public ingress to the load balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # No port 80 ingress at all. A redirect from HTTP would still accept a plaintext request
  # carrying an Authorization header before it could redirect it.

  egress {
    description     = "To the application tasks only"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Application tasks"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "HTTPS to AWS service endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}

resource "aws_security_group_rule" "tasks_from_alb" {
  description              = "Only the load balancer may reach the tasks"
  type                     = "ingress"
  from_port                = 3001
  to_port                  = 3001
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "Databases and cache. Reachable only from the tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from the tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }

  ingress {
    description     = "Redis from the tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

# --- Data -------------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_db_instance" "postgres" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 50
  storage_encrypted     = true

  db_name  = "guardianlink"
  username = "guardianlink"
  # Generated and stored in Secrets Manager rather than passed in as a variable, so no
  # password value ever appears in a tfvars file or on a command line.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.data.id]
  publicly_accessible    = false

  # Single AZ in dev. Production is multi-AZ; saying so here rather than making them
  # identical is the point of having separate environments.
  multi_az = false

  backup_retention_period = 7
  skip_final_snapshot     = true
  deletion_protection     = false

  # Deletion protection off and final snapshot skipped are correct for dev and would be
  # wrong anywhere else. Production sets both.
  auto_minor_version_upgrade = true
  apply_immediately          = true
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = local.name
  engine               = "redis"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.1"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.data.id]

  # No snapshots. Redis holds rate-limit counters, short-lived state and locks. Backing it
  # up would imply it holds something that matters.
  snapshot_retention_limit = 0
}

# --- Messaging --------------------------------------------------------------------------

resource "aws_sqs_queue" "notifications_dlq" {
  name                      = "${local.name}-notifications-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${local.name}-notifications"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    # Matches the retry budget in the application. If these disagree, either SQS gives up
    # before the app has finished retrying or the app retries messages SQS has already
    # dead-lettered.
    maxReceiveCount = 5
  })
}

# --- Storage ----------------------------------------------------------------------------

resource "aws_s3_bucket" "exports" {
  bucket = "${local.name}-exports-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket = aws_s3_bucket.exports.id

  # A data export is the single most sensitive object this system produces.
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    # Exports expire. A download link that lives for ever is a link that eventually leaks,
    # and the object behind it should not outlive the link.
    expiration {
      days = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# --- Alarm topics -----------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic" "pager" {
  name = "${local.name}-pager"
}
