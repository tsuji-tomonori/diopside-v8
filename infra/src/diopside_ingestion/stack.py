"""Storage-only AWS CDK resources for the finite private material backfill."""
# pyright: reportArgumentType=false

from __future__ import annotations

from typing import Any

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_s3 as s3
from cdk_nag import NagSuppressions
from constructs import Construct


class IngestionStack(Stack):
    """Keep private artifacts and resumable status without cloud-side execution."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        raw_bucket = s3.Bucket(
            self,
            "RawMaterialBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=True,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
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
            encryption=dynamodb.TableEncryption.DEFAULT,
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        NagSuppressions.add_resource_suppressions(
            raw_bucket,
            [
                {
                    "id": "AwsSolutions-S1",
                    "reason": (
                        "This finite operator-triggered private backfill intentionally omits a "
                        "second access-log bucket; public access block, TLS enforcement, "
                        "versioning, and checksum verification remain enabled."
                    ),
                }
            ],
        )

        CfnOutput(self, "RawMaterialBucketName", value=raw_bucket.bucket_name)
        CfnOutput(self, "VideoIngestionTableName", value=table.table_name)
