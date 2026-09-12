from __future__ import annotations

from aws_cdk import App
from aws_cdk.assertions import Template

from diopside_ingestion.stack import IngestionStack


def test_stack_has_only_private_storage_resources() -> None:
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

    template.resource_count_is("AWS::SQS::Queue", 0)
    template.resource_count_is("AWS::Lambda::EventSourceMapping", 0)
    template.resource_count_is("AWS::Lambda::Function", 0)
    template.resource_count_is("AWS::Logs::LogGroup", 0)
    template.resource_count_is("AWS::IAM::Role", 0)
    template.resource_count_is("AWS::IAM::Policy", 0)
    template.resource_count_is("AWS::Batch::JobDefinition", 0)
    template.resource_count_is("AWS::Batch::ComputeEnvironment", 0)
    template.resource_count_is("AWS::Batch::JobQueue", 0)
    template.resource_count_is("AWS::EC2::VPC", 0)
    template.resource_count_is("AWS::ECR::Repository", 0)
    template.resource_count_is("AWS::Events::Rule", 0)
    template.resource_count_is("AWS::KMS::Key", 0)
    template.resource_count_is("AWS::KMS::Alias", 0)
    assert set(template.to_json().get("Outputs", {})) == {
        "RawMaterialBucketName",
        "VideoIngestionTableName",
    }
    assert set(template.to_json()["Resources"]) == {
        "RawMaterialBucketB8C67129",
        "RawMaterialBucketPolicyCCCFC5BF",
        "VideoIngestion9A244137",
    }
    for logical_id in ("RawMaterialBucketB8C67129", "VideoIngestion9A244137"):
        resource = template.to_json()["Resources"][logical_id]
        assert resource["DeletionPolicy"] == "Retain"
        assert resource["UpdateReplacePolicy"] == "Retain"
    serialized = str(template.to_json()).lower()
    assert "sqs:" not in serialized
    assert "lambda:" not in serialized
    assert "logs:" not in serialized
    assert "kms:" not in serialized


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
    template.resource_count_is("AWS::Logs::LogGroup", 0)
