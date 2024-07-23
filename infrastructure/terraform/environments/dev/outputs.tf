output "database_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "Postgres endpoint. Not sensitive on its own; credentials live in Secrets Manager."
}

output "database_secret_arn" {
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
  description = "ARN of the generated master password. The value never passes through Terraform."
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "notification_queue_url" {
  value = aws_sqs_queue.notifications.url
}

output "dead_letter_queue_url" {
  value       = aws_sqs_queue.notifications_dlq.url
  description = "A non-empty queue here means an alert never reached the person it was raised for."
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}

output "vpc_id" {
  value = aws_vpc.main.id
}
