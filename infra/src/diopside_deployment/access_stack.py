"""GitHub Actions OIDC access for private ingestion deploy and enqueue operations."""
# pyright: reportArgumentType=false

from __future__ import annotations

from typing import Any

from aws_cdk import Aws, CfnOutput, CfnParameter, Stack
from aws_cdk import aws_iam as iam
from constructs import Construct

_GITHUB_OIDC_PROVIDER_HOST = "token.actions.githubusercontent.com"
_GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com"
_GITHUB_OIDC_REPOSITORY = "tsuji-tomonori@39981658/diopside-v8@1321865971"
_DEPLOYMENT_ENVIRONMENT = "private-backfill-infra"
_ENQUEUE_ENVIRONMENT = "private-backfill-enqueue"
_GITHUB_OIDC_SUBJECT = f"repo:{_GITHUB_OIDC_REPOSITORY}:environment:{_DEPLOYMENT_ENVIRONMENT}"
_GITHUB_ENQUEUE_OIDC_SUBJECT = f"repo:{_GITHUB_OIDC_REPOSITORY}:environment:{_ENQUEUE_ENVIRONMENT}"
_TARGET_DEPLOYMENT_REGION = "ap-northeast-1"
_BOOTSTRAP_QUALIFIER = "hnb659fds"
_REQUEST_QUEUE_NAME = "diopside-ingestion-request.fifo"


class GitHubDeploymentAccessStack(Stack):
    """Allow exact protected GitHub environments to deploy or enqueue one video."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs: Any) -> None:
        super().__init__(scope, construct_id, **kwargs)

        github_oidc_subject = CfnParameter(
            self,
            "GitHubOidcSubject",
            type="String",
            default=_GITHUB_OIDC_SUBJECT,
            description=(
                "Exact immutable GitHub Actions OIDC subject for the protected "
                f"{_DEPLOYMENT_ENVIRONMENT} environment"
            ),
            allowed_values=[_GITHUB_OIDC_SUBJECT],
            constraint_description=(
                f"Use the exact {_GITHUB_OIDC_SUBJECT} subject emitted by GitHub"
            ),
        )
        target_deployment_region = CfnParameter(
            self,
            "TargetDeploymentRegion",
            type="String",
            default=_TARGET_DEPLOYMENT_REGION,
            allowed_values=[_TARGET_DEPLOYMENT_REGION],
            description=(
                "Region containing the CDK bootstrap roles used by the private backfill deploy"
            ),
        )
        provider_arn = (
            f"arn:{Aws.PARTITION}:iam::{Aws.ACCOUNT_ID}:oidc-provider/{_GITHUB_OIDC_PROVIDER_HOST}"
        )
        deploy_role = iam.Role(
            self,
            "GitHubActionsDeployRole",
            role_name="diopside-github-actions-deploy",
            description="Receives short-lived OIDC sessions for the private backfill CDK deploy",
            assumed_by=iam.FederatedPrincipal(
                federated=provider_arn,
                conditions={
                    "StringEquals": {
                        f"{_GITHUB_OIDC_PROVIDER_HOST}:aud": _GITHUB_OIDC_AUDIENCE,
                        f"{_GITHUB_OIDC_PROVIDER_HOST}:sub": (github_oidc_subject.value_as_string),
                    }
                },
                assume_role_action="sts:AssumeRoleWithWebIdentity",
            ),
        )

        bootstrap_role_arns = [
            (
                f"arn:{Aws.PARTITION}:iam::{Aws.ACCOUNT_ID}:role/"
                f"cdk-{_BOOTSTRAP_QUALIFIER}-{role_kind}-role-"
                f"{Aws.ACCOUNT_ID}-{target_deployment_region.value_as_string}"
            )
            for role_kind in ["deploy", "file-publishing", "lookup"]
        ]
        deploy_role.add_to_policy(
            iam.PolicyStatement(
                sid="AssumeRequiredCdkBootstrapRoles",
                actions=["sts:AssumeRole"],
                resources=bootstrap_role_arns,
            )
        )

        enqueue_oidc_subject = CfnParameter(
            self,
            "GitHubEnqueueOidcSubject",
            type="String",
            default=_GITHUB_ENQUEUE_OIDC_SUBJECT,
            description=(
                "Exact immutable GitHub Actions OIDC subject for the protected "
                f"{_ENQUEUE_ENVIRONMENT} environment"
            ),
            allowed_values=[_GITHUB_ENQUEUE_OIDC_SUBJECT],
            constraint_description=(
                f"Use the exact {_GITHUB_ENQUEUE_OIDC_SUBJECT} subject emitted by GitHub"
            ),
        )
        enqueue_role = iam.Role(
            self,
            "GitHubActionsEnqueueRole",
            role_name="diopside-github-actions-enqueue",
            description="Receives short-lived OIDC sessions for one-video SQS enqueue",
            assumed_by=iam.FederatedPrincipal(
                federated=provider_arn,
                conditions={
                    "StringEquals": {
                        f"{_GITHUB_OIDC_PROVIDER_HOST}:aud": _GITHUB_OIDC_AUDIENCE,
                        f"{_GITHUB_OIDC_PROVIDER_HOST}:sub": (enqueue_oidc_subject.value_as_string),
                    }
                },
                assume_role_action="sts:AssumeRoleWithWebIdentity",
            ),
        )
        enqueue_role.add_to_policy(
            iam.PolicyStatement(
                sid="SendOnlyToIngestionRequestQueue",
                actions=["sqs:SendMessage"],
                resources=[
                    (
                        f"arn:{Aws.PARTITION}:sqs:"
                        f"{target_deployment_region.value_as_string}:"
                        f"{Aws.ACCOUNT_ID}:{_REQUEST_QUEUE_NAME}"
                    )
                ],
            )
        )

        CfnOutput(
            self,
            "GitHubActionsDeployRoleArn",
            value=deploy_role.role_arn,
            description="Set this ARN as the protected environment AWS_DEPLOY_ROLE_ARN variable",
        )
        CfnOutput(
            self,
            "GitHubActionsDeploymentRegion",
            value=target_deployment_region.value_as_string,
            description="Set this value as the protected environment AWS_REGION variable",
        )
        CfnOutput(
            self,
            "GitHubActionsEnqueueRoleArn",
            value=enqueue_role.role_arn,
            description="Set this ARN as the protected environment AWS_ENQUEUE_ROLE_ARN variable",
        )
