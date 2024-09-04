variable "project" {
  type        = string
  description = "Project name, used as a resource-name prefix and a cost-allocation tag."
  default     = "agricore"
}

variable "environment" {
  type        = string
  description = "dev, staging or production."

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging or production."
  }
}

variable "region" {
  type = string
}

variable "account_id" {
  type        = string
  description = "Used in the assume-role condition that prevents a confused-deputy."
}

variable "image" {
  type        = string
  description = "Fully qualified image reference including the tag."
}

variable "cpu" {
  type    = string
  default = "512"
}

variable "memory" {
  type    = string
  default = "1024"
}

variable "desired_count" {
  type    = number
  default = 2

  validation {
    # One task means a deploy is an outage and an AZ failure is an outage. If you
    # genuinely want a single task, say so in the environment configuration rather than
    # arriving at it by leaving a default alone.
    condition     = var.desired_count >= 1
    error_message = "Desired count must be at least 1."
  }
}

variable "log_retention_days" {
  type        = number
  default     = 30
  description = "Bounded on purpose: logs are a privacy surface in this product."
}

variable "log_kms_key_arn" {
  type    = string
  default = null
}

variable "cluster_arn" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "target_group_suffix" { type = string }
variable "load_balancer_suffix" { type = string }

variable "queue_url" { type = string }
variable "queue_arn" { type = string }
variable "queue_name" { type = string }
variable "dead_letter_queue_arn" { type = string }
variable "dead_letter_queue_name" { type = string }

variable "exports_bucket_arn" { type = string }
variable "exports_bucket_name" { type = string }
variable "kms_key_arn" { type = string }

variable "secret_arns" {
  type        = list(string)
  description = "ARNs the task and execution roles may read. Never values."
}

variable "secret_references" {
  type        = map(string)
  description = "Environment variable name to Secrets Manager ARN. Values never appear in state."
}

variable "alarm_topic_arn" {
  type        = string
  description = "SNS topic for alarms that need attention during working hours."
}

variable "pager_topic_arn" {
  type        = string
  description = "SNS topic for alarms that wake somebody. Outbox backlog and dead letters only."
}
