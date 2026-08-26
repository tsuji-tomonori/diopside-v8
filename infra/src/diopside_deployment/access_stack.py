"""GitHub Actions OIDC access for private ingestion deploy and enqueue operations."""
# pyright: reportArgumentType=false

from __future__ import annotations

from typing import Any

from aws_cdk import Aws, CfnOutput, CfnParameter, Stack
from aws_cdk import aws_iam as iam
from constructs import Construct

_GITHUB_OIDC_PROVIDER_HOST = "token.actions.githubusercontent.com"
_GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com"
_DEPLOYMENT_ENVIRONMENT = "private-backfill-infra"
_ENQUEUE_ENVIRONMENT = "private-backfill-enqueue"
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
            description=(
                "Exact GitHub Actions OIDC subject for the protected "
                f"{_DEPLOYMENT_ENVIRONMENT} environment"
            ),
            allowed_pattern=(rf"^repo:[^:]+/[^:]+:environment:{_DEPLOYMENT_ENVIRONMENT}$"),
            constraint_description=(
                "Use the exact repo:<owner>/<repository>:environment:"
                f"{_DEPLOYMENT_ENVIRONMENT} subject emitted by GitHub"
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
                f"{Aws.ACCOUNT_ID}-{Aws.REGION}"
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
            description=(
                "Exact GitHub Actions OIDC subject for the protected "
                f"{_ENQUEUE_ENVIRONMENT} environment"
            ),
            allowed_pattern=(rf"^repo:[^:]+/[^:]+:environment:{_ENQUEUE_ENVIRONMENT}$"),
            constraint_description=(
                "Use the exact repo:<owner>/<repository>:environment:"
                f"{_ENQUEUE_ENVIRONMENT} subject emitted by GitHub"
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
                    (f"arn:{Aws.PARTITION}:sqs:{Aws.REGION}:{Aws.ACCOUNT_ID}:{_REQUEST_QUEUE_NAME}")
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
            "GitHubActionsEnqueueRoleArn",
            value=enqueue_role.role_arn,
            description="Set this ARN as the protected environment AWS_ENQUEUE_ROLE_ARN variable",
        )
