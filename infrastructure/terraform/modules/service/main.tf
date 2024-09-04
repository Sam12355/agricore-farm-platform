/**
 * ECS Fargate service behind an ALB.
 *
 * Written but never applied. No AWS account was used and no resource was created. See
 * DEPLOYMENT.md for what that means for the claims in this repository.
 */

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

locals {
  name = "${var.project}-${var.environment}"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    # Every resource carries this. A portfolio demo left running by accident should be
    # obvious in a cost report rather than hiding in a line item.
    Purpose = "portfolio-demonstration"
  }
}

# --- Logs -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "service" {
  name = "/ecs/${local.name}"

  # Logs are a privacy surface in this product: the redaction layer keeps coordinates and
  # addresses out of them, and a bounded retention keeps whatever does get through from
  # living forever.
  retention_in_days = var.log_retention_days
  kms_key_id        = var.log_kms_key_arn

  tags = local.tags
}

# --- Task role: what the running container may do -------------------------------------

resource "aws_iam_role" "task" {
  name = "${local.name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        # Without this, any ECS task in any account could assume the role if its ARN
        # leaked. The confused-deputy guard costs nothing.
        ArnLike     = { "aws:SourceArn" = "arn:aws:ecs:${var.region}:${var.account_id}:*" }
        StringEquals = { "aws:SourceAccount" = var.account_id }
      }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "task" {
  name = "${local.name}-task-policy"
  role = aws_iam_role.task.id

  # Least privilege, resource-scoped throughout. No wildcard resource anywhere: the task
  # can read exactly its own secrets, use exactly its own queue, and write to exactly its
  # own bucket prefix.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadOwnSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.secret_arns
      },
      {
        Sid    = "OwnQueueOnly"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = [var.queue_arn, var.dead_letter_queue_arn]
      },
      {
        Sid      = "ExportsPrefixOnly"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = ["${var.exports_bucket_arn}/exports/*"]
      },
      {
        Sid      = "DecryptWithOwnKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.kms_key_arn]
      },
    ]
  })
}

# --- Execution role: what ECS may do on the task's behalf before it starts -------------

resource "aws_iam_role" "execution" {
  name = "${local.name}-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role needs to read secrets to inject them as environment variables at
# start. It is kept separate from the task role so a compromise of the running process
# does not also give image-pull and log-group permissions.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name}-execution-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secret_arns
    }]
  })
}

# --- Task definition ------------------------------------------------------------------

resource "aws_ecs_task_definition" "service" {
  family                   = local.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.image
    essential = true

    portMappings = [{ containerPort = 3001, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "PERSISTENCE", value = "postgres" },
      { name = "CACHE", value = "redis" },
      { name = "TELEMETRY_STORE", value = "mongodb" },
      { name = "NOTIFICATION_TRANSPORT", value = "sqs" },
      { name = "OBJECT_STORE", value = "s3" },
      { name = "SQS_QUEUE_URL", value = var.queue_url },
      { name = "S3_BUCKET", value = var.exports_bucket_name },
      { name = "AWS_REGION", value = var.region },
    ]

    # Secrets arrive by reference, never as plaintext in the task definition. A task
    # definition is readable by anyone with ecs:DescribeTaskDefinition.
    secrets = [for key, arn in var.secret_references : { name = key, valueFrom = arn }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }

    # Liveness, not readiness. Restarting a task because its database blipped turns a
    # recoverable alert into an outage. Readiness is the load balancer's question and
    # is answered at /ready.
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }

    readonlyRootFilesystem = true
    user                   = "node"
  }])

  tags = local.tags
}

# --- Service --------------------------------------------------------------------------

resource "aws_ecs_service" "service" {
  name            = local.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets = var.private_subnet_ids
    # Private subnets with no public address. Egress goes through a NAT gateway in
    # production and through VPC endpoints in dev, where the NAT costs more than the
    # compute it serves.
    assign_public_ip = false
    security_groups  = [var.security_group_id]
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "api"
    container_port   = 3001
  }

  # Give the app time to drain in-flight requests and finish an outbox batch it has
  # already claimed. This is the difference between a deploy nobody notices and a deploy
  # that produces a burst of connection resets.
  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = local.tags

  lifecycle {
    # The image tag moves with each deployment and is managed by the release pipeline,
    # not by Terraform. Without this, every plan shows a diff.
    ignore_changes = [task_definition]
  }
}

# --- Alarms ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  alarm_name          = "${local.name}-unhealthy-hosts"
  comparison_manager = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "A task is failing its readiness check."
  alarm_actions       = [var.alarm_topic_arn]

  dimensions = {
    TargetGroup  = var.target_group_suffix
    LoadBalancer = var.load_balancer_suffix
  }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${local.name}-5xx"
  comparison_manager = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_description   = "Elevated server errors."
  alarm_actions       = [var.alarm_topic_arn]

  dimensions = {
    LoadBalancer = var.load_balancer_suffix
  }

  tags = local.tags
}

# The one that wakes somebody. A backing-up outbox means alerts are not reaching the
# people they were raised for, which is the only failure in this system that matters to a
# person rather than to a dashboard.
resource "aws_cloudwatch_metric_alarm" "outbox_backlog" {
  alarm_name          = "${local.name}-outbox-backlog"
  comparison_manager = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 100
  alarm_description   = "Notifications are not being delivered."
  alarm_actions       = [var.pager_topic_arn]

  dimensions = { QueueName = var.queue_name }

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  alarm_name          = "${local.name}-dead-letters"
  comparison_manager = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "A notification was permanently undeliverable."
  alarm_actions       = [var.pager_topic_arn]

  dimensions = { QueueName = var.dead_letter_queue_name }

  tags = local.tags
}
