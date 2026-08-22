"""AWS CDK resources for the finite, non-public material backfill."""
# pyright: reportArgumentType=false

from __future__ import annotations

from pathlib import Path
from typing import Any

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Size, Stack
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_kms as kms
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_sqs as sqs
from cdk_nag import NagSuppressions
from constructs import Construct

_LAMBDA_ASSET_EXCLUDES = [
    "**/__pycache__/**",
    "**/*.py[cod]",
    "**/.coverage",
    "**/.mypy_cache/**",
    "**/.pytest_cache/**",
    "**/.ruff_cache/**",
]


class IngestionStack(Stack):
    """Run bounded private ingestion directly from one SQS-triggered Lambda."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        lambda_source_directory: Path | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        source_directory = lambda_source_directory or Path(__file__).resolve().parents[1]

        encryption_key = kms.Key(
            self,
            "IngestionEncryptionKey",
            alias="alias/diopside-ingestion",
            enable_key_rotation=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        access_log_bucket = s3.Bucket(
            self,
            "AccessLogBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.KMS,
            encryption_key=encryption_key,
            enforce_ssl=True,
            object_ownership=s3.ObjectOwnership.OBJECT_WRITER,
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,
            lifecycle_rules=[
                s3.LifecycleRule(
                    enabled=True,
                    expiration=Duration.days(90),
                    abort_incomplete_multipart_upload_after=Duration.days(7),
                )
            ],
        )
        raw_bucket = s3.Bucket(
            self,
            "RawMaterialBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.KMS,
            encryption_key=encryption_key,
            enforce_ssl=True,
            versioned=True,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
            server_access_logs_bucket=access_log_bucket,
            server_access_logs_prefix="raw-material/",
            removal_policy=RemovalPolicy.RETAIN,
            auto_delete_objects=False,
            lifecycle_rules=[
                s3.LifecycleRule(
                    enabled=True,
                    abort_incomplete_multipart_upload_after=Duration.days(7),
                    noncurrent_version_expiration=Duration.days(30),
                ),
                s3.LifecycleRule(enabled=True, prefix="staging/", expiration=Duration.days(7)),
                s3.LifecycleRule(enabled=True, prefix="failed/", expiration=Duration.days(30)),
            ],
        )
        table = dynamodb.Table(
            self,
            "VideoIngestion",
            partition_key=dynamodb.Attribute(name="video_id", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption=dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryption_key=encryption_key,
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        request_dlq = sqs.Queue(
            self,
            "RequestDeadLetterQueue",
            queue_name="diopside-ingestion-request-dlq.fifo",
            fifo=True,
            content_based_deduplication=True,
            encryption=sqs.QueueEncryption.KMS,
            encryption_master_key=encryption_key,
            enforce_ssl=True,
            retention_period=Duration.days(14),
            visibility_timeout=Duration.minutes(15),
        )
        request_queue = sqs.Queue(
            self,
            "RequestQueue",
            queue_name="diopside-ingestion-request.fifo",
            fifo=True,
            content_based_deduplication=True,
            deduplication_scope=sqs.DeduplicationScope.MESSAGE_GROUP,
            fifo_throughput_limit=sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
            encryption=sqs.QueueEncryption.KMS,
            encryption_master_key=encryption_key,
            enforce_ssl=True,
            receive_message_wait_time=Duration.seconds(20),
            visibility_timeout=Duration.minutes(90),
            dead_letter_queue=sqs.DeadLetterQueue(queue=request_dlq, max_receive_count=3),
        )

        worker_log_group = logs.LogGroup(
            self,
            "WorkerLogGroup",
            encryption_key=encryption_key,
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.RETAIN,
        )
        worker_role = iam.Role(
            self,
            "WorkerRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Runs one bounded private ingestion from an SQS request",
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(
                actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                resources=[f"{worker_log_group.log_group_arn}:*"],
            )
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "sqs:ChangeMessageVisibility",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes",
                    "sqs:ReceiveMessage",
                ],
                resources=[request_queue.queue_arn],
            )
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(actions=["s3:ListBucket"], resources=[raw_bucket.bucket_arn])
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(
                actions=["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
                resources=[raw_bucket.arn_for_objects("*")],
            )
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:UpdateItem"],
                resources=[table.table_arn],
            )
        )
        worker_role.add_to_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt", "kms:GenerateDataKey"],
                resources=[encryption_key.key_arn],
            )
        )

        worker = lambda_.Function(
            self,
            "Worker",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="diopside_ingestion.dispatcher.lambda_handler",
            code=lambda_.Code.from_asset(
                str(source_directory),
                exclude=_LAMBDA_ASSET_EXCLUDES,
            ),
            role=worker_role,
            log_group=worker_log_group,
            timeout=Duration.minutes(15),
            memory_size=4096,
            ephemeral_storage_size=Size.gibibytes(10),
            reserved_concurrent_executions=5,
            environment={
                "S3_BUCKET": raw_bucket.bucket_name,
                "VIDEO_INGESTION_TABLE": table.table_name,
                "WORKER_RUNTIME": "lambda-python3.12",
            },
            tracing=lambda_.Tracing.PASS_THROUGH,
        )
        lambda_.CfnEventSourceMapping(
            self,
            "RequestQueueEventSource",
            event_source_arn=request_queue.queue_arn,
            function_name=worker.function_name,
            batch_size=1,
            enabled=True,
            function_response_types=["ReportBatchItemFailures"],
        )

        NagSuppressions.add_resource_suppressions(
            worker_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "CloudWatch Logs creates arbitrary stream names only under the fixed "
                        "private worker log group."
                    ),
                    "applies_to": [f"Resource::{worker_log_group.log_group_arn}:*"],
                },
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "A video-specific prefix is discovered after metadata resolution; the "
                        "role remains scoped to this private material bucket."
                    ),
                    "applies_to": [f"Resource::{raw_bucket.arn_for_objects('*')}"],
                },
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            worker,
            [
                {
                    "id": "AwsSolutions-L1",
                    "reason": (
                        "Python 3.12 is pinned with the validated ingestion dependencies; a "
                        "runtime upgrade requires separate compatibility validation."
                    ),
                }
            ],
        )

        CfnOutput(self, "RawMaterialBucketName", value=raw_bucket.bucket_name)
        CfnOutput(self, "VideoIngestionTableName", value=table.table_name)
        CfnOutput(self, "RequestQueueUrl", value=request_queue.queue_url)
