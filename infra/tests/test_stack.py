from __future__ import annotations

from aws_cdk import App
from aws_cdk.assertions import Template

from diopside_ingestion.stack import IngestionStack


def test_stack_has_one_table_fifo_queue_and_bounded_lambda_worker() -> None:
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
    assert table["Properties"]["SSESpecification"] == {"SSEEnabled": False}

    template.resource_count_is("AWS::SQS::Queue", 2)
    template.has_resource_properties("AWS::SQS::Queue", {"FifoQueue": True})
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Runtime": "python3.12",
            "Timeout": 900,
            "MemorySize": 4096,
            "EphemeralStorage": {"Size": 10_240},
            "ReservedConcurrentExecutions": 5,
        },
    )
    template.resource_count_is("AWS::Lambda::EventSourceMapping", 1)
    template.resource_count_is("AWS::Lambda::Function", 1)
    template.resource_count_is("AWS::Batch::JobDefinition", 0)
    template.resource_count_is("AWS::Batch::ComputeEnvironment", 0)
    template.resource_count_is("AWS::Batch::JobQueue", 0)
    template.resource_count_is("AWS::EC2::VPC", 0)
    template.resource_count_is("AWS::ECR::Repository", 0)
    template.resource_count_is("AWS::Events::Rule", 0)
    template.resource_count_is("AWS::KMS::Key", 0)
    template.resource_count_is("AWS::KMS::Alias", 0)
    assert "WorkerImageDigest" not in template.to_json().get("Parameters", {})

    for queue in template.find_resources("AWS::SQS::Queue").values():
        assert queue["Properties"]["SqsManagedSseEnabled"] is True

    worker_policies = template.find_resources("AWS::IAM::Policy")
    assert "kms:" not in str(worker_policies).lower()

    request_queues = template.find_resources(
        "AWS::SQS::Queue", {"Properties": {"VisibilityTimeout": 5400}}
    )
    assert len(request_queues) == 1
    request_queue = next(iter(request_queues.values()))
    assert request_queue["Properties"]["RedrivePolicy"]["maxReceiveCount"] == 3


def test_stack_keeps_material_bucket_private_and_versioned() -> None:
    app = App()
    stack = IngestionStack(app, "TestIngestion")
    template = Template.from_stack(stack)
    template.resource_count_is("AWS::S3::Bucket", 1)
    template.resource_count_is("AWS::S3::BucketPolicy", 1)
    template.has_resource_properties(
        "AWS::S3::Bucket",
        {
            "BucketEncryption": {
                "ServerSideEncryptionConfiguration": [
                    {"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                ]
            },
            "VersioningConfiguration": {"Status": "Enabled"},
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "BlockPublicPolicy": True,
                "IgnorePublicAcls": True,
                "RestrictPublicBuckets": True,
            },
        },
    )
    bucket = next(iter(template.find_resources("AWS::S3::Bucket").values()))
    assert "LoggingConfiguration" not in bucket["Properties"]
    for log_group in template.find_resources("AWS::Logs::LogGroup").values():
        assert "KmsKeyId" not in log_group["Properties"]
