from __future__ import annotations

from aws_cdk import App
from aws_cdk.assertions import Match, Template

from diopside_ingestion.stack import IngestionStack


def test_stack_has_one_table_fifo_queue_and_fargate_worker() -> None:
    app = App()
    stack = IngestionStack(app, "TestIngestion")
    template = Template.from_stack(stack)

    template.resource_count_is("AWS::DynamoDB::Table", 1)
    template.has_resource_properties(
        "AWS::DynamoDB::Table",
        {
            "BillingMode": "PAY_PER_REQUEST",
            "KeySchema": [{"AttributeName": "video_id", "KeyType": "HASH"}],
            "AttributeDefinitions": [{"AttributeName": "video_id", "AttributeType": "S"}],
        },
    )
    table = next(iter(template.find_resources("AWS::DynamoDB::Table").values()))
    assert "GlobalSecondaryIndexes" not in table["Properties"]

    template.resource_count_is("AWS::SQS::Queue", 3)
    template.has_resource_properties("AWS::SQS::Queue", {"FifoQueue": True})
    template.has_resource_properties(
        "AWS::Batch::JobDefinition",
        {
            "PlatformCapabilities": ["FARGATE"],
            "Timeout": {"AttemptDurationSeconds": 21_600},
            "ContainerProperties": Match.object_like(
                {"NetworkConfiguration": {"AssignPublicIp": "ENABLED"}}
            ),
        },
    )
    template.resource_count_is("AWS::Lambda::EventSourceMapping", 3)
    template.resource_count_is("AWS::Lambda::Function", 3)
    template.has_resource_properties(
        "AWS::Events::Rule",
        {
            "Targets": Match.array_with(
                [
                    Match.object_like(
                        {
                            "RetryPolicy": {
                                "MaximumEventAgeInSeconds": 7200,
                                "MaximumRetryAttempts": 6,
                            },
                            "DeadLetterConfig": Match.object_like({"Arn": Match.any_value()}),
                        }
                    )
                ]
            )
        },
    )
    template.resource_count_is("AWS::EC2::FlowLog", 1)
    template.has_parameter(
        "WorkerImageDigest",
        {"AllowedPattern": "^sha256:[a-f0-9]{64}$"},
    )


def test_stack_keeps_material_bucket_private_and_versioned() -> None:
    app = App()
    stack = IngestionStack(app, "TestIngestion")
    template = Template.from_stack(stack)
    template.has_resource_properties(
        "AWS::S3::Bucket",
        {
            "VersioningConfiguration": {"Status": "Enabled"},
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "BlockPublicPolicy": True,
                "IgnorePublicAcls": True,
                "RestrictPublicBuckets": True,
            },
        },
    )
