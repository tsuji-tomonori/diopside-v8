from __future__ import annotations

import json
import os
import subprocess
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast
from uuid import uuid4

import boto3
import pytest
from botocore.config import Config
from moto.server import ThreadedMotoServer

import diopside_ingestion.dispatcher as dispatcher_module
from diopside_ingestion.dispatcher import Dispatcher, lambda_handler
from diopside_ingestion.state import DynamoIngestionRepository
from diopside_ingestion.worker import IngestionWorker, ObjectStore, WorkerConfig

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient
    from mypy_boto3_s3 import S3Client
    from mypy_boto3_sqs import SQSClient

REGION: Literal["ap-northeast-1"] = "ap-northeast-1"
VIDEO_ID = "dQw4w9WgXcQ"


@dataclass(frozen=True)
class AwsResources:
    dynamodb: DynamoDBClient
    s3: S3Client
    sqs: SQSClient
    table_name: str
    bucket_name: str
    queue_url: str


@dataclass
class FixtureRunner:
    fail_native_audio: bool = False
    calls: list[list[str]] = field(default_factory=lambda: list[list[str]]())

    def run(self, args: Sequence[str], *, cwd: Path) -> subprocess.CompletedProcess[bytes]:
        command = list(args)
        self.calls.append(command)
        if command == ["yt-dlp", "--version"]:
            return subprocess.CompletedProcess(command, 0, b"2026.7.4\n", b"")
        if "--dump-single-json" in command:
            payload = json.dumps(
                {"channel_id": "UC1234567890", "description": "integration fixture"}
            ).encode()
            return subprocess.CompletedProcess(command, 0, payload, b"")
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"flac")
            return subprocess.CompletedProcess(command, 0, b"", b"")
        if command[0] != "yt-dlp":
            raise AssertionError(command)

        output = Path(command[command.index("-o") + 1])
        output.parent.mkdir(parents=True, exist_ok=True)
        if "-f" in command and self.fail_native_audio:
            return subprocess.CompletedProcess(command, 1, b"", b"HTTP Error 429")

        extension = "json"
        payload = b"artifact"
        if "--sub-format" in command and "json3" in command:
            extension = "json3"
            payload = b'{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"caption"}]}]}'
        elif "--sub-format" in command and "vtt" in command:
            extension = "vtt"
            payload = b"WEBVTT\n\n00:00.000 --> 00:01.000\ncaption\n"
        elif "--write-comments" in command:
            payload = b'{"comments":[{"timestamp":1,"text":"comment"}]}'
        if "-f" in command:
            extension = "webm"
        if "--write-thumbnail" in command:
            extension = "jpg"
        (output.parent / f"artifact.{extension}").write_bytes(payload)
        return subprocess.CompletedProcess(command, 0, b"", b"")


@dataclass(frozen=True)
class LambdaContextFixture:
    def get_remaining_time_in_millis(self) -> int:
        return 900_000


@pytest.fixture(scope="module")
def aws_endpoint() -> Iterator[str]:
    configured_endpoint = os.environ.get("DIOPSIDE_AWS_ENDPOINT_URL")
    if configured_endpoint:
        if configured_endpoint.startswith("https://") or not configured_endpoint.startswith(
            "http://127.0.0.1:"
        ):
            raise RuntimeError("DIOPSIDE_AWS_ENDPOINT_URL must be a loopback HTTP endpoint")
        yield configured_endpoint
        return

    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    host, port = server.get_host_and_port()
    try:
        yield f"http://{host}:{port}"
    finally:
        server.stop()


@pytest.fixture
def aws_resources(aws_endpoint: str) -> Iterator[AwsResources]:
    suffix = uuid4().hex[:12]
    local_credential = f"local-emulator-{suffix}"
    retry_config = Config(retries={"max_attempts": 1, "mode": "standard"})
    dynamodb = boto3.client(  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        "dynamodb",
        endpoint_url=aws_endpoint,
        region_name=REGION,
        aws_access_key_id=local_credential,
        aws_secret_access_key=local_credential,
        config=retry_config,
    )
    s3 = boto3.client(  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        "s3",
        endpoint_url=aws_endpoint,
        region_name=REGION,
        aws_access_key_id=local_credential,
        aws_secret_access_key=local_credential,
        config=Config(
            retries={"max_attempts": 1, "mode": "standard"},
            s3={"addressing_style": "path"},
        ),
    )
    sqs = boto3.client(  # pyright: ignore[reportUnknownMemberType] -- boto3 overload issue.
        "sqs",
        endpoint_url=aws_endpoint,
        region_name=REGION,
        aws_access_key_id=local_credential,
        aws_secret_access_key=local_credential,
        config=retry_config,
    )
    table_name = f"VideoIngestion-{suffix}"
    bucket_name = f"diopside-integration-{suffix}"

    dynamodb.create_table(
        TableName=table_name,
        AttributeDefinitions=[{"AttributeName": "video_id", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "video_id", "KeyType": "HASH"}],
        BillingMode="PAY_PER_REQUEST",
    )
    dynamodb.get_waiter("table_exists").wait(
        TableName=table_name,
        WaiterConfig={"Delay": 1, "MaxAttempts": 10},
    )
    s3.create_bucket(
        Bucket=bucket_name,
        CreateBucketConfiguration={"LocationConstraint": REGION},
    )
    queue_url = sqs.create_queue(
        QueueName=f"diopside-integration-{suffix}.fifo",
        Attributes={"FifoQueue": "true", "ContentBasedDeduplication": "true"},
    )["QueueUrl"]
    resources = AwsResources(
        dynamodb=dynamodb,
        s3=s3,
        sqs=sqs,
        table_name=table_name,
        bucket_name=bucket_name,
        queue_url=queue_url,
    )

    try:
        yield resources
    finally:
        listed = s3.list_objects_v2(Bucket=bucket_name)
        objects = listed.get("Contents", [])
        object_keys: list[str] = []
        for item in objects:
            key = item.get("Key")
            if isinstance(key, str):
                object_keys.append(key)
        if object_keys:
            s3.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": [{"Key": key} for key in object_keys]},
            )
        s3.delete_bucket(Bucket=bucket_name)
        sqs.delete_queue(QueueUrl=queue_url)
        dynamodb.delete_table(TableName=table_name)


def repository(resources: AwsResources) -> DynamoIngestionRepository:
    return DynamoIngestionRepository(resources.dynamodb, resources.table_name)


def receive_record(resources: AwsResources) -> tuple[dict[str, object], str]:
    for _attempt in range(20):
        response = resources.sqs.receive_message(
            QueueUrl=resources.queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=1,
        )
        messages = response.get("Messages", [])
        if messages:
            message = messages[0]
            message_id = message.get("MessageId")
            body = message.get("Body")
            receipt_handle = message.get("ReceiptHandle")
            if (
                not isinstance(message_id, str)
                or not isinstance(body, str)
                or not isinstance(receipt_handle, str)
            ):
                raise AssertionError("SQS response omitted a required message field")
            return (
                {"messageId": message_id, "body": body},
                receipt_handle,
            )
        time.sleep(0.05)
    raise AssertionError("SQS message was not available")


@pytest.mark.aws_integration
def test_real_dynamodb_claim_decodes_numbers_and_enforces_lease(
    aws_resources: AwsResources,
) -> None:
    state = repository(aws_resources)

    first = state.claim(VIDEO_ID, "message-1", 900)
    blocked = state.claim(VIDEO_ID, "message-2", 900)
    aws_resources.dynamodb.update_item(
        TableName=aws_resources.table_name,
        Key={"video_id": {"S": VIDEO_ID}},
        UpdateExpression="SET claim_expires_at = :expired",
        ExpressionAttributeValues={":expired": {"N": "0"}},
    )
    resumed = state.claim(VIDEO_ID, "message-2", 900)
    item = state.load(VIDEO_ID)

    assert first.claimed is True
    assert first.attempt_count == 1
    assert blocked.claimed is False
    assert resumed.claimed is True
    assert resumed.attempt_count == 2
    assert item is not None
    assert item["attempt_count"] == 2
    assert isinstance(item["attempt_count"], int)


@pytest.mark.aws_integration
def test_sqs_lambda_dispatcher_retries_and_completes_with_real_state_and_objects(
    aws_resources: AwsResources,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = repository(aws_resources)
    configs: list[WorkerConfig] = []

    def worker_factory(config: WorkerConfig) -> IngestionWorker:
        configs.append(config)
        return IngestionWorker(
            config=config,
            repository=state,
            store=cast(ObjectStore, aws_resources.s3),
            runner=FixtureRunner(fail_native_audio=config.run_id.endswith("-1")),
        )

    dispatcher = Dispatcher(
        repository=state,
        worker_factory=worker_factory,
        bucket=aws_resources.bucket_name,
        table_name=aws_resources.table_name,
        runtime_version="lambda-python3.12",
    )

    def build_dispatcher(_context: object) -> Dispatcher:
        return dispatcher

    monkeypatch.setattr(dispatcher_module, "build_dispatcher", build_dispatcher)
    aws_resources.sqs.send_message(
        QueueUrl=aws_resources.queue_url,
        MessageBody=json.dumps({"video_id": VIDEO_ID}),
        MessageGroupId=VIDEO_ID,
    )

    first_record, first_receipt = receive_record(aws_resources)
    first_result = lambda_handler({"Records": [first_record]}, LambdaContextFixture())
    assert first_result == {"batchItemFailures": [{"itemIdentifier": first_record["messageId"]}]}

    aws_resources.sqs.change_message_visibility(
        QueueUrl=aws_resources.queue_url,
        ReceiptHandle=first_receipt,
        VisibilityTimeout=0,
    )
    second_record, second_receipt = receive_record(aws_resources)
    second_result = lambda_handler({"Records": [second_record]}, LambdaContextFixture())
    assert second_result == {"batchItemFailures": []}
    aws_resources.sqs.delete_message(
        QueueUrl=aws_resources.queue_url,
        ReceiptHandle=second_receipt,
    )

    item = state.load(VIDEO_ID)
    assert item is not None
    assert item["status"] == "succeeded"
    assert item["attempt_count"] == 2
    assert isinstance(item["attempt_count"], int)
    assert [config.run_id for config in configs] == [
        f"ingest-{VIDEO_ID}-1",
        f"ingest-{VIDEO_ID}-2",
    ]

    listed = aws_resources.s3.list_objects_v2(Bucket=aws_resources.bucket_name)
    keys = [key for item in listed.get("Contents", []) if isinstance(key := item.get("Key"), str)]
    assert any(f"/runs/ingest-{VIDEO_ID}-1/" in key for key in keys)
    assert any(f"/runs/ingest-{VIDEO_ID}-2/" in key for key in keys)
    assert any(key.endswith(f"/{VIDEO_ID}/manifest.json") for key in keys)
