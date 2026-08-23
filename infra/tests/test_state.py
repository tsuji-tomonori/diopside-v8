from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

import pytest

from diopside_ingestion.state import DynamoIngestionRepository

if TYPE_CHECKING:
    from mypy_boto3_dynamodb import DynamoDBClient


@dataclass
class FakeDynamoClient:
    update_response: dict[str, object] = field(default_factory=lambda: dict[str, object]())
    get_response: dict[str, object] = field(default_factory=lambda: dict[str, object]())

    def update_item(self, **_kwargs: object) -> dict[str, object]:
        return self.update_response

    def get_item(self, **_kwargs: object) -> dict[str, object]:
        return self.get_response


def repository(client: FakeDynamoClient) -> DynamoIngestionRepository:
    return DynamoIngestionRepository(cast("DynamoDBClient", client), "VideoIngestion")


def test_claim_accepts_dynamodb_number_attempt_count() -> None:
    client = FakeDynamoClient(update_response={"Attributes": {"attempt_count": {"N": "1"}}})

    claim = repository(client).claim("dQw4w9WgXcQ", "message-1", 900)

    assert claim.claimed is True
    assert claim.attempt_count == 1
    assert isinstance(claim.attempt_count, int)


def test_load_normalizes_nested_dynamodb_integer_numbers() -> None:
    client = FakeDynamoClient(
        get_response={
            "Item": {
                "video_id": {"S": "dQw4w9WgXcQ"},
                "attempt_count": {"N": "2"},
                "artifacts": {
                    "M": {
                        "comments": {
                            "M": {
                                "attempt_count": {"N": "3"},
                                "phases": {"M": {"download": {"M": {"attempt_count": {"N": "4"}}}}},
                            }
                        }
                    }
                },
            }
        }
    )

    item = repository(client).load("dQw4w9WgXcQ")

    assert item is not None
    assert item["attempt_count"] == 2
    artifacts = cast(dict[str, object], item["artifacts"])
    comments = cast(dict[str, object], artifacts["comments"])
    assert comments["attempt_count"] == 3
    phases = cast(dict[str, object], comments["phases"])
    download = cast(dict[str, object], phases["download"])
    assert download["attempt_count"] == 4


def test_load_rejects_non_integral_dynamodb_numbers() -> None:
    client = FakeDynamoClient(
        get_response={
            "Item": {
                "video_id": {"S": "dQw4w9WgXcQ"},
                "attempt_count": {"N": "1.5"},
            }
        }
    )

    with pytest.raises(RuntimeError, match="non-integral"):
        repository(client).load("dQw4w9WgXcQ")
