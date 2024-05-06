#!/bin/sh
# Creates the SQS queues and S3 bucket the API expects, once LocalStack reports ready.
#
# The dead-letter queue and redrive policy are set up here rather than left implicit,
# because the retry and dead-letter behaviour is one of the things this project claims
# to demonstrate, and it should be visible locally rather than only in Terraform.
set -eu

REGION=eu-west-1

awslocal sqs create-queue \
  --queue-name guardianlink-notifications-dlq \
  --region "$REGION" >/dev/null

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/guardianlink-notifications-dlq \
  --attribute-names QueueArn --region "$REGION" \
  --query 'Attributes.QueueArn' --output text)

awslocal sqs create-queue \
  --queue-name guardianlink-notifications \
  --region "$REGION" \
  --attributes "{
    \"VisibilityTimeout\": \"60\",
    \"MessageRetentionPeriod\": \"345600\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"
  }" >/dev/null

awslocal s3 mb s3://guardianlink-local --region "$REGION" >/dev/null

# Exports are the most sensitive object the system produces. Blocking public access
# locally as well as in Terraform means the local setup cannot teach a bad habit.
awslocal s3api put-public-access-block \
  --bucket guardianlink-local \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "localstack: queues and bucket ready"
