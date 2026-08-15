"""DynamoDB persistence for one-video-one-item ingestion state."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from time import time
from typing import TYPE_CHECKING, Any, Protocol

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient
    from mypy_boto3_dynamodb.type_defs import AttributeValueTypeDef

from diopside_ingestion.contracts import VideoStatus, initial_artifacts, initial_item, iso_now


@dataclass(frozen=True)
class ClaimResult:
    """Whether a dispatcher acquired the only active worker claim for a video."""

    claimed: bool
    attempt_count: int = 0


class IngestionRepository(Protocol):
    """Persistence boundary shared by Lambda handlers and the worker."""

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult: ...

    def record_batch_job(self, video_id: str, claim_owner: str, batch_job_id: str) -> None: ...

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None: ...

    def load(self, video_id: str) -> Mapping[str, object] | None: ...

    def checkpoint(
        self,
        video_id: str,
        claim_owner: str,
        *,
        artifacts: Mapping[str, Mapping[str, object]],
        current_stage: str,
        channel_id: str | None = None,
        s3_prefix: str | None = None,
        run_id: str | None = None,
        worker_image_digest: str | None = None,
        yt_dlp_version: str | None = None,
    ) -> None: ...

    def complete(
        self,
        video_id: str,
        claim_owner: str,
        *,
        status: VideoStatus,
        artifacts: Mapping[str, Mapping[str, object]],
        manifest_key: str | None,
        manifest_sha256: str | None,
        last_reason_code: str | None,
        next_action: str,
    ) -> None: ...

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None: ...


_SERIALIZER = TypeSerializer()
_DESERIALIZER = TypeDeserializer()


def _attribute(value: object) -> AttributeValueTypeDef:
    return _SERIALIZER.serialize(value)


def _read_item(item: Mapping[str, AttributeValueTypeDef]) -> dict[str, object]:
    return {key: _DESERIALIZER.deserialize(value) for key, value in item.items()}


class DynamoIngestionRepository:
    """Low-level DynamoDB adapter that keeps raw external content out of the table."""

    def __init__(self, client: DynamoDBClient, table_name: str) -> None:
        self._client = client
        self._table_name = table_name

    def claim(self, video_id: str, claim_owner: str, lease_seconds: int) -> ClaimResult:
        now = iso_now()
        now_epoch = int(time())
        item = initial_item(video_id, now)
        try:
            response = self._client.update_item(
                TableName=self._table_name,
                Key={"video_id": _attribute(video_id)},
                ConditionExpression=(
                    "attribute_not_exists(#video_id) OR "
                    "(#status IN (:queued, :retryable) AND "
                    "(attribute_not_exists(#claim_expires_at) OR #claim_expires_at < :now_epoch))"
                ),
                UpdateExpression=(
                    "SET #status = :running, #current_stage = :dispatch, "
                    "#artifacts = if_not_exists(#artifacts, :artifacts), "
                    "#attempt_count = if_not_exists(#attempt_count, :zero) + :one, "
                    "#claim_owner = :claim_owner, #claim_expires_at = :claim_expires_at, "
                    "#version = if_not_exists(#version, :zero) + :one, "
                    "#created_at = if_not_exists(#created_at, :created_at), "
                    "#started_at = if_not_exists(#started_at, :started_at), "
                    "#updated_at = :updated_at, #next_action = :next_action"
                ),
                ExpressionAttributeNames={
                    "#video_id": "video_id",
                    "#status": "status",
                    "#current_stage": "current_stage",
                    "#artifacts": "artifacts",
                    "#attempt_count": "attempt_count",
                    "#claim_owner": "claim_owner",
                    "#claim_expires_at": "claim_expires_at",
                    "#version": "version",
                    "#created_at": "created_at",
                    "#started_at": "started_at",
                    "#updated_at": "updated_at",
                    "#next_action": "next_action",
                },
                ExpressionAttributeValues={
                    ":queued": _attribute(VideoStatus.QUEUED.value),
                    ":retryable": _attribute(VideoStatus.RETRYABLE_FAILED.value),
                    ":running": _attribute(VideoStatus.RUNNING.value),
                    ":dispatch": _attribute("dispatch"),
                    ":artifacts": _attribute(initial_artifacts(now)),
                    ":zero": _attribute(0),
                    ":one": _attribute(1),
                    ":claim_owner": _attribute(claim_owner),
                    ":claim_expires_at": _attribute(now_epoch + lease_seconds),
                    ":now_epoch": _attribute(now_epoch),
                    ":created_at": _attribute(item["created_at"]),
                    ":started_at": _attribute(item["created_at"]),
                    ":updated_at": _attribute(now),
                    ":next_action": _attribute("retry"),
                },
                ReturnValues="ALL_NEW",
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return ClaimResult(claimed=False)
            raise
        attributes = response.get("Attributes", {})
        decoded = _read_item(attributes)
        attempt_count = decoded.get("attempt_count")
        if not isinstance(attempt_count, int):
            raise RuntimeError("DynamoDB claim result has no integer attempt_count")
        return ClaimResult(claimed=True, attempt_count=attempt_count)

    def record_batch_job(self, video_id: str, claim_owner: str, batch_job_id: str) -> None:
        self._client.update_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConditionExpression="#claim_owner = :claim_owner AND #status = :running",
            UpdateExpression=(
                "SET #batch_job_id = :batch_job_id, #current_stage = :current_stage, "
                "#updated_at = :updated_at, #version = #version + :one"
            ),
            ExpressionAttributeNames={
                "#claim_owner": "claim_owner",
                "#status": "status",
                "#batch_job_id": "batch_job_id",
                "#current_stage": "current_stage",
                "#updated_at": "updated_at",
                "#version": "version",
            },
            ExpressionAttributeValues={
                ":claim_owner": _attribute(claim_owner),
                ":running": _attribute(VideoStatus.RUNNING.value),
                ":batch_job_id": _attribute(batch_job_id),
                ":current_stage": _attribute("collect"),
                ":updated_at": _attribute(iso_now()),
                ":one": _attribute(1),
            },
        )

    def mark_dispatch_failure(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        self._client.update_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConditionExpression="#claim_owner = :claim_owner",
            UpdateExpression=(
                "SET #status = :status, #current_stage = :current_stage, "
                "#last_reason_code = :reason, #next_action = :next_action, "
                "#updated_at = :updated_at, #version = #version + :one "
                "REMOVE #claim_owner, #claim_expires_at"
            ),
            ExpressionAttributeNames={
                "#claim_owner": "claim_owner",
                "#claim_expires_at": "claim_expires_at",
                "#status": "status",
                "#current_stage": "current_stage",
                "#last_reason_code": "last_reason_code",
                "#next_action": "next_action",
                "#updated_at": "updated_at",
                "#version": "version",
            },
            ExpressionAttributeValues={
                ":claim_owner": _attribute(claim_owner),
                ":status": _attribute(VideoStatus.RETRYABLE_FAILED.value),
                ":current_stage": _attribute("dispatch"),
                ":reason": _attribute(reason_code),
                ":next_action": _attribute("retry"),
                ":updated_at": _attribute(iso_now()),
                ":one": _attribute(1),
            },
        )

    def load(self, video_id: str) -> Mapping[str, object] | None:
        response = self._client.get_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConsistentRead=True,
        )
        item = response.get("Item")
        return _read_item(item) if item else None

    def checkpoint(
        self,
        video_id: str,
        claim_owner: str,
        *,
        artifacts: Mapping[str, Mapping[str, object]],
        current_stage: str,
        channel_id: str | None = None,
        s3_prefix: str | None = None,
        run_id: str | None = None,
        worker_image_digest: str | None = None,
        yt_dlp_version: str | None = None,
    ) -> None:
        names = {
            "#claim_owner": "claim_owner",
            "#artifacts": "artifacts",
            "#current_stage": "current_stage",
            "#updated_at": "updated_at",
            "#version": "version",
        }
        values: dict[str, AttributeValueTypeDef] = {
            ":claim_owner": _attribute(claim_owner),
            ":artifacts": _attribute(dict(artifacts)),
            ":current_stage": _attribute(current_stage),
            ":updated_at": _attribute(iso_now()),
            ":one": _attribute(1),
        }
        assignments = [
            "#artifacts = :artifacts",
            "#current_stage = :current_stage",
            "#updated_at = :updated_at",
            "#version = #version + :one",
        ]
        for placeholder, attribute_name, value in (
            ("#channel_id", "channel_id", channel_id),
            ("#s3_prefix", "s3_prefix", s3_prefix),
            ("#current_run_id", "current_run_id", run_id),
            ("#worker_image_digest", "worker_image_digest", worker_image_digest),
            ("#yt_dlp_version", "yt_dlp_version", yt_dlp_version),
        ):
            if value is not None:
                names[placeholder] = attribute_name
                marker = ":" + attribute_name
                values[marker] = _attribute(value)
                assignments.append(f"{placeholder} = {marker}")
        self._client.update_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConditionExpression="#claim_owner = :claim_owner",
            UpdateExpression="SET " + ", ".join(assignments),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )

    def complete(
        self,
        video_id: str,
        claim_owner: str,
        *,
        status: VideoStatus,
        artifacts: Mapping[str, Mapping[str, object]],
        manifest_key: str | None,
        manifest_sha256: str | None,
        last_reason_code: str | None,
        next_action: str,
    ) -> None:
        now = iso_now()
        values: dict[str, AttributeValueTypeDef] = {
            ":claim_owner": _attribute(claim_owner),
            ":status": _attribute(status.value),
            ":completed": _attribute("completed"),
            ":artifacts": _attribute(dict(artifacts)),
            ":manifest_key": _attribute(manifest_key),
            ":manifest_sha256": _attribute(manifest_sha256),
            ":last_reason_code": _attribute(last_reason_code),
            ":next_action": _attribute(next_action),
            ":updated_at": _attribute(now),
            ":completed_at": _attribute(now),
            ":one": _attribute(1),
        }
        self._client.update_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConditionExpression="#claim_owner = :claim_owner",
            UpdateExpression=(
                "SET #status = :status, #current_stage = :completed, #artifacts = :artifacts, "
                "#manifest_key = :manifest_key, #manifest_sha256 = :manifest_sha256, "
                "#last_reason_code = :last_reason_code, #next_action = :next_action, "
                "#updated_at = :updated_at, #completed_at = :completed_at, "
                "#version = #version + :one "
                "REMOVE #claim_owner, #claim_expires_at"
            ),
            ExpressionAttributeNames={
                "#claim_owner": "claim_owner",
                "#claim_expires_at": "claim_expires_at",
                "#status": "status",
                "#current_stage": "current_stage",
                "#artifacts": "artifacts",
                "#manifest_key": "manifest_key",
                "#manifest_sha256": "manifest_sha256",
                "#last_reason_code": "last_reason_code",
                "#next_action": "next_action",
                "#updated_at": "updated_at",
                "#completed_at": "completed_at",
                "#version": "version",
            },
            ExpressionAttributeValues=values,
        )

    def mark_unavailable(self, video_id: str, claim_owner: str, reason_code: str) -> None:
        """Terminally close a worker crash after the bounded retry policy is exhausted."""
        now = iso_now()
        self._client.update_item(
            TableName=self._table_name,
            Key={"video_id": _attribute(video_id)},
            ConditionExpression="#claim_owner = :claim_owner",
            UpdateExpression=(
                "SET #status = :status, #current_stage = :completed, #last_reason_code = :reason, "
                "#next_action = :next_action, #updated_at = :updated_at, "
                "#completed_at = :completed_at, "
                "#version = #version + :one REMOVE #claim_owner, #claim_expires_at"
            ),
            ExpressionAttributeNames={
                "#claim_owner": "claim_owner",
                "#claim_expires_at": "claim_expires_at",
                "#status": "status",
                "#current_stage": "current_stage",
                "#last_reason_code": "last_reason_code",
                "#next_action": "next_action",
                "#updated_at": "updated_at",
                "#completed_at": "completed_at",
                "#version": "version",
            },
            ExpressionAttributeValues={
                ":claim_owner": _attribute(claim_owner),
                ":status": _attribute(VideoStatus.UNAVAILABLE.value),
                ":completed": _attribute("completed"),
                ":reason": _attribute(reason_code),
                ":next_action": _attribute("none"),
                ":updated_at": _attribute(now),
                ":completed_at": _attribute(now),
                ":one": _attribute(1),
            },
        )

    def scan_items(self) -> Iterable[Mapping[str, object]]:
        """Scan intentionally without an index: the table has one item per target video."""
        exclusive_start_key: dict[str, AttributeValueTypeDef] | None = None
        while True:
            kwargs: dict[str, Any] = {"TableName": self._table_name}
            if exclusive_start_key:
                kwargs["ExclusiveStartKey"] = exclusive_start_key
            response = self._client.scan(**kwargs)
            for item in response.get("Items", []):
                yield _read_item(item)
            exclusive_start_key = response.get("LastEvaluatedKey")
            if not exclusive_start_key:
                return
