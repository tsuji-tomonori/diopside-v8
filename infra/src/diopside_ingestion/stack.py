"""AWS CDK resources for the finite, non-public material backfill."""
# pyright: reportArgumentType=false

from __future__ import annotations

from pathlib import Path
from typing import Any

from aws_cdk import (
    CfnOutput,
    CfnParameter,
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
)
from aws_cdk import (
    aws_batch as batch,
)
from aws_cdk import (
    aws_dynamodb as dynamodb,
)
from aws_cdk import (
    aws_ec2 as ec2,
)
from aws_cdk import (
    aws_ecr as ecr,
)
from aws_cdk import (
    aws_events as events,
)
from aws_cdk import (
    aws_events_targets as events_targets,
)
from aws_cdk import (
    aws_iam as iam,
)
from aws_cdk import (
    aws_kms as kms,
)
from aws_cdk import (
    aws_lambda as lambda_,
)
from aws_cdk import (
    aws_logs as logs,
)
from aws_cdk import (
    aws_s3 as s3,
)
from aws_cdk import (
    aws_sqs as sqs,
)
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
    """Isolate raw artifacts from the static public Pages deployment."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs: Any) -> None:
        super().__init__(scope, construct_id, **kwargs)
        lambda_source_directory = Path(__file__).resolve().parents[1]

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
            visibility_timeout=Duration.minutes(5),
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
            visibility_timeout=Duration.minutes(5),
            dead_letter_queue=sqs.DeadLetterQueue(queue=request_dlq, max_receive_count=3),
        )
        result_event_dlq = sqs.Queue(
            self,
            "ResultEventDeadLetterQueue",
            queue_name="diopside-ingestion-result-event-dlq",
            encryption=sqs.QueueEncryption.KMS,
            encryption_master_key=encryption_key,
            enforce_ssl=True,
            retention_period=Duration.days(14),
            visibility_timeout=Duration.minutes(5),
        )
        repository = ecr.Repository(
            self,
            "WorkerRepository",
            image_scan_on_push=True,
            image_tag_mutability=ecr.TagMutability.IMMUTABLE,
            encryption=ecr.RepositoryEncryption.KMS,
            encryption_key=encryption_key,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                ecr.LifecycleRule(max_image_count=10, description="Keep recent worker images")
            ],
        )

        vpc = ec2.Vpc(
            self,
            "WorkerVpc",
            max_azs=2,
            nat_gateways=0,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="public-worker",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24,
                )
            ],
        )
        worker_security_group = ec2.SecurityGroup(
            self,
            "WorkerSecurityGroup",
            vpc=vpc,
            allow_all_outbound=False,
            description="Only DNS and HTTPS egress for public video collection",
        )
        worker_security_group.add_egress_rule(ec2.Peer.ipv4(vpc.vpc_cidr_block), ec2.Port.udp(53))
        worker_security_group.add_egress_rule(ec2.Peer.ipv4(vpc.vpc_cidr_block), ec2.Port.tcp(53))
        worker_security_group.add_egress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(443))

        flow_log_group = logs.LogGroup(
            self,
            "WorkerVpcFlowLogGroup",
            encryption_key=encryption_key,
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.RETAIN,
        )
        flow_log_role = iam.Role(
            self,
            "WorkerVpcFlowLogRole",
            assumed_by=iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
            description="Delivers VPC flow metadata to the private retention-bound log group",
        )
        flow_log_role.add_to_policy(
            iam.PolicyStatement(
                actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                resources=[f"{flow_log_group.log_group_arn}:*"],
            )
        )
        ec2.CfnFlowLog(
            self,
            "WorkerVpcFlowLog",
            resource_id=vpc.vpc_id,
            resource_type="VPC",
            traffic_type="ALL",
            log_destination_type="cloud-watch-logs",
            log_group_name=flow_log_group.log_group_name,
            deliver_logs_permission_arn=flow_log_role.role_arn,
            max_aggregation_interval=60,
        )

        dispatcher_log_group = self._lambda_log_group("DispatcherLogGroup", encryption_key)
        result_log_group = self._lambda_log_group("ResultLogGroup", encryption_key)
        recovery_log_group = self._lambda_log_group("RecoveryLogGroup", encryption_key)
        dispatcher_role = self._lambda_role("DispatcherRole", dispatcher_log_group)
        result_role = self._lambda_role("ResultRole", result_log_group)
        recovery_role = self._lambda_role("RecoveryRole", recovery_log_group)
        worker_execution_role = iam.Role(
            self,
            "WorkerExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Fetches the immutable worker image and writes bounded task logs",
        )
        worker_job_role = iam.Role(
            self,
            "WorkerJobRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Writes private material artifacts and checkpoint-only ingestion state",
        )
        batch_service_role = iam.Role(
            self,
            "BatchServiceRole",
            assumed_by=iam.ServicePrincipal("batch.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AWSBatchServiceRole")
            ],
        )

        worker_log_group = logs.LogGroup(
            self,
            "WorkerLogGroup",
            encryption_key=encryption_key,
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.RETAIN,
        )
        worker_execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage",
                ],
                resources=[repository.repository_arn],
            )
        )
        worker_execution_role.add_to_policy(
            iam.PolicyStatement(actions=["ecr:GetAuthorizationToken"], resources=["*"])
        )
        worker_execution_role.add_to_policy(
            iam.PolicyStatement(
                actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                resources=[f"{worker_log_group.log_group_arn}:*"],
            )
        )
        worker_job_role.add_to_policy(
            iam.PolicyStatement(actions=["s3:ListBucket"], resources=[raw_bucket.bucket_arn])
        )
        worker_job_role.add_to_policy(
            iam.PolicyStatement(
                actions=["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
                resources=[raw_bucket.arn_for_objects("*")],
            )
        )
        worker_job_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:UpdateItem"], resources=[table.table_arn]
            )
        )
        worker_job_role.add_to_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt", "kms:GenerateDataKey"], resources=[encryption_key.key_arn]
            )
        )

        compute_environment = batch.CfnComputeEnvironment(
            self,
            "FargateComputeEnvironment",
            type="MANAGED",
            state="ENABLED",
            service_role=batch_service_role.role_arn,
            compute_resources=batch.CfnComputeEnvironment.ComputeResourcesProperty(
                type="FARGATE",
                maxv_cpus=16,
                subnets=[subnet.subnet_id for subnet in vpc.public_subnets],
                security_group_ids=[worker_security_group.security_group_id],
            ),
        )
        job_queue = batch.CfnJobQueue(
            self,
            "WorkerJobQueue",
            priority=1,
            state="ENABLED",
            job_queue_type="ECS_FARGATE",
            compute_environment_order=[
                batch.CfnJobQueue.ComputeEnvironmentOrderProperty(
                    compute_environment=compute_environment.ref,
                    order=1,
                )
            ],
        )
        worker_image_digest = CfnParameter(
            self,
            "WorkerImageDigest",
            type="String",
            allowed_pattern=r"^sha256:[a-f0-9]{64}$",
            constraint_description="WorkerImageDigest must be a sha256 image digest.",
            description=(
                "Immutable sha256 digest for the pre-scanned worker image in the ECR repository"
            ),
        )
        job_definition = batch.CfnJobDefinition(
            self,
            "WorkerJobDefinition",
            type="container",
            platform_capabilities=["FARGATE"],
            propagate_tags=True,
            retry_strategy=batch.CfnJobDefinition.RetryStrategyProperty(attempts=1),
            timeout=batch.CfnJobDefinition.TimeoutProperty(attempt_duration_seconds=21_600),
            container_properties=batch.CfnJobDefinition.ContainerPropertiesProperty(
                image=Fn.join(
                    "", [repository.repository_uri, "@", worker_image_digest.value_as_string]
                ),
                execution_role_arn=worker_execution_role.role_arn,
                job_role_arn=worker_job_role.role_arn,
                user="10001",
                network_configuration=batch.CfnJobDefinition.NetworkConfigurationProperty(
                    assign_public_ip="ENABLED"
                ),
                environment=[
                    batch.CfnJobDefinition.EnvironmentProperty(
                        name="S3_BUCKET",
                        value=raw_bucket.bucket_name,
                    ),
                    batch.CfnJobDefinition.EnvironmentProperty(
                        name="VIDEO_INGESTION_TABLE",
                        value=table.table_name,
                    ),
                    batch.CfnJobDefinition.EnvironmentProperty(
                        name="WORKER_IMAGE_DIGEST",
                        value=worker_image_digest.value_as_string,
                    ),
                ],
                resource_requirements=[
                    batch.CfnJobDefinition.ResourceRequirementProperty(type="VCPU", value="2"),
                    batch.CfnJobDefinition.ResourceRequirementProperty(type="MEMORY", value="4096"),
                ],
                fargate_platform_configuration=batch.CfnJobDefinition.FargatePlatformConfigurationProperty(
                    platform_version="LATEST"
                ),
                ephemeral_storage=batch.CfnJobDefinition.EphemeralStorageProperty(size_in_gib=100),
                log_configuration=batch.CfnJobDefinition.LogConfigurationProperty(
                    log_driver="awslogs",
                    options={
                        "awslogs-group": worker_log_group.log_group_name,
                        "awslogs-region": Stack.of(self).region,
                        "awslogs-stream-prefix": "worker",
                    },
                ),
            ),
        )
        compute_environment.add_resource_dependency(batch_service_role.node.default_child)  # type: ignore[arg-type]
        job_queue.add_resource_dependency(compute_environment)

        dispatcher = self._lambda_function(
            "Dispatcher",
            role=dispatcher_role,
            log_group=dispatcher_log_group,
            source_directory=lambda_source_directory,
            handler="diopside_ingestion.dispatcher.lambda_handler",
            environment={
                "VIDEO_INGESTION_TABLE": table.table_name,
                "BATCH_JOB_QUEUE": job_queue.ref,
                "BATCH_JOB_DEFINITION": job_definition.ref,
            },
        )
        dispatcher_role.add_to_policy(
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
        dispatcher_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:UpdateItem"], resources=[table.table_arn]
            )
        )
        dispatcher_role.add_to_policy(
            iam.PolicyStatement(actions=["kms:Decrypt"], resources=[encryption_key.key_arn])
        )
        dispatcher_role.add_to_policy(
            iam.PolicyStatement(
                actions=["batch:SubmitJob"],
                resources=[job_queue.attr_job_queue_arn, job_definition.attr_job_definition_arn],
            )
        )
        dispatcher_role.add_to_policy(
            iam.PolicyStatement(actions=["batch:ListJobs"], resources=["*"])
        )
        lambda_.CfnEventSourceMapping(
            self,
            "RequestQueueEventSource",
            event_source_arn=request_queue.queue_arn,
            function_name=dispatcher.function_name,
            batch_size=1,
            enabled=True,
            function_response_types=["ReportBatchItemFailures"],
        )

        result_handler = self._lambda_function(
            "ResultHandler",
            role=result_role,
            log_group=result_log_group,
            source_directory=lambda_source_directory,
            handler="diopside_ingestion.result_handler.lambda_handler",
            environment={
                "VIDEO_INGESTION_TABLE": table.table_name,
                "REQUEST_QUEUE_URL": request_queue.queue_url,
            },
        )
        result_role.add_to_policy(
            iam.PolicyStatement(actions=["sqs:SendMessage"], resources=[request_queue.queue_arn])
        )
        result_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:UpdateItem"], resources=[table.table_arn]
            )
        )
        result_role.add_to_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt", "kms:GenerateDataKey"], resources=[encryption_key.key_arn]
            )
        )
        result_role.add_to_policy(
            iam.PolicyStatement(actions=["batch:DescribeJobs"], resources=["*"])
        )
        recovery_handler = self._lambda_function(
            "RecoveryHandler",
            role=recovery_role,
            log_group=recovery_log_group,
            source_directory=lambda_source_directory,
            handler="diopside_ingestion.recovery.lambda_handler",
            environment={
                "VIDEO_INGESTION_TABLE": table.table_name,
                "REQUEST_QUEUE_URL": request_queue.queue_url,
                "BATCH_JOB_QUEUE": job_queue.ref,
            },
        )
        recovery_role.add_to_policy(
            iam.PolicyStatement(actions=["sqs:SendMessage"], resources=[request_queue.queue_arn])
        )
        recovery_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "sqs:ChangeMessageVisibility",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes",
                    "sqs:ReceiveMessage",
                ],
                resources=[request_dlq.queue_arn, result_event_dlq.queue_arn],
            )
        )
        recovery_role.add_to_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:Scan", "dynamodb:UpdateItem"],
                resources=[table.table_arn],
            )
        )
        recovery_role.add_to_policy(
            iam.PolicyStatement(actions=["batch:DescribeJobs", "batch:ListJobs"], resources=["*"])
        )
        recovery_role.add_to_policy(
            iam.PolicyStatement(
                actions=["kms:Decrypt", "kms:GenerateDataKey"], resources=[encryption_key.key_arn]
            )
        )
        batch_events = events.Rule(
            self,
            "BatchResultRule",
            event_pattern=events.EventPattern(
                source=["aws.batch"],
                detail_type=["Batch Job State Change"],
                detail={"status": ["SUCCEEDED", "FAILED"]},
            ),
        )
        batch_events.add_target(
            events_targets.LambdaFunction(
                result_handler,
                dead_letter_queue=result_event_dlq,
                max_event_age=Duration.hours(2),
                retry_attempts=6,
            )
        )
        for identifier, queue in (
            ("RequestDlqRecoveryEventSource", request_dlq),
            ("ResultDlqRecoveryEventSource", result_event_dlq),
        ):
            lambda_.CfnEventSourceMapping(
                self,
                identifier,
                event_source_arn=queue.queue_arn,
                function_name=recovery_handler.function_name,
                batch_size=1,
                enabled=True,
            )

        NagSuppressions.add_resource_suppressions(
            result_event_dlq,
            [
                {
                    "id": "AwsSolutions-SQS3",
                    "reason": (
                        "This queue is itself the EventBridge target DLQ for both result and "
                        "scheduled recovery invocations; chaining another DLQ is not useful."
                    ),
                }
            ],
        )

        NagSuppressions.add_resource_suppressions(
            batch_service_role,
            [
                {
                    "id": "AwsSolutions-IAM4",
                    "reason": (
                        "AWS Batch requires its AWS-managed control-plane role; all application "
                        "data permissions are instead defined on custom execution and job roles."
                    ),
                    "applies_to": [
                        "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBatchServiceRole"
                    ],
                }
            ],
        )
        NagSuppressions.add_resource_suppressions(
            worker_execution_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "ecr:GetAuthorizationToken does not support a repository ARN resource."
                    ),
                    "applies_to": ["Resource::*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            worker_execution_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "CloudWatch Logs uses an arbitrary stream name under the fixed, "
                        "private worker log group."
                    ),
                    "applies_to": [f"Resource::{worker_log_group.log_group_arn}:*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            result_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": "batch:DescribeJobs does not support resource-level authorization.",
                    "applies_to": ["Resource::*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            recovery_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "Batch ListJobs and DescribeJobs do not support resource-level "
                        "authorization; recovery only reconciles IDs from the private table."
                    ),
                    "applies_to": ["Resource::*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            result_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "CloudWatch Logs uses an arbitrary stream name under the fixed, "
                        "private result-handler log group."
                    ),
                    "applies_to": [f"Resource::{result_log_group.log_group_arn}:*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            worker_job_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "A video-specific prefix is determined only after metadata resolution; "
                        "the role remains scoped to this private bucket."
                    ),
                    "applies_to": [f"Resource::{raw_bucket.arn_for_objects('*')}"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            dispatcher_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "CloudWatch Logs uses an arbitrary stream name under the fixed, "
                        "private dispatcher log group."
                    ),
                    "applies_to": [f"Resource::{dispatcher_log_group.log_group_arn}:*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            dispatcher_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "Batch ListJobs does not support resource-level authorization and is "
                        "used only to reconcile a persisted deterministic job name."
                    ),
                    "applies_to": ["Resource::*"],
                }
            ],
            apply_to_children=True,
        )
        NagSuppressions.add_resource_suppressions(
            flow_log_role,
            [
                {
                    "id": "AwsSolutions-IAM5",
                    "reason": (
                        "VPC Flow Logs creates stream names under the fixed, private flow-log "
                        "group; it has no access to any other log group."
                    ),
                    "applies_to": [f"Resource::{flow_log_group.log_group_arn}:*"],
                }
            ],
            apply_to_children=True,
        )
        for function in (dispatcher, result_handler, recovery_handler):
            NagSuppressions.add_resource_suppressions(
                function,
                [
                    {
                        "id": "AwsSolutions-L1",
                        "reason": (
                            "Python 3.12 is pinned consistently for the CDK app, Lambda handlers, "
                            "and the validated yt-dlp worker image; a runtime upgrade requires a "
                            "separate compatibility validation."
                        ),
                    }
                ],
            )

        CfnOutput(self, "RawMaterialBucketName", value=raw_bucket.bucket_name)
        CfnOutput(self, "VideoIngestionTableName", value=table.table_name)
        CfnOutput(self, "RequestQueueUrl", value=request_queue.queue_url)
        CfnOutput(self, "WorkerRepositoryUri", value=repository.repository_uri)

    def _lambda_log_group(self, identifier: str, encryption_key: kms.Key) -> logs.LogGroup:
        """Create a pre-provisioned, encrypted Lambda log group with finite retention."""
        return logs.LogGroup(
            self,
            identifier,
            encryption_key=encryption_key,
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.RETAIN,
        )

    def _lambda_role(self, identifier: str, log_group: logs.LogGroup) -> iam.Role:
        """Create a custom role instead of inheriting broad managed Lambda policies."""
        role = iam.Role(
            self,
            identifier,
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Least-privilege ingestion control-plane Lambda role",
        )
        role.add_to_policy(
            iam.PolicyStatement(
                actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                resources=[f"{log_group.log_group_arn}:*"],
            )
        )
        return role

    def _lambda_function(
        self,
        identifier: str,
        *,
        role: iam.Role,
        log_group: logs.LogGroup,
        source_directory: Path,
        handler: str,
        environment: dict[str, str],
    ) -> lambda_.Function:
        """Create a finite-control-plane Lambda with no raw payload logging."""
        return lambda_.Function(
            self,
            identifier,
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler=handler,
            # Test and type-check caches differ by runner/Python patch version.  Keep
            # them out of the deployable artifact so the synthesized template stays
            # deterministic across local and CI validation environments.
            code=lambda_.Code.from_asset(
                str(source_directory),
                exclude=_LAMBDA_ASSET_EXCLUDES,
            ),
            role=role,
            log_group=log_group,
            timeout=Duration.minutes(2),
            memory_size=512,
            reserved_concurrent_executions=5,
            environment=environment,
            tracing=lambda_.Tracing.PASS_THROUGH,
        )
