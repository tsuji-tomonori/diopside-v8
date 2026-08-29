from __future__ import annotations

import json

from aws_cdk import App, Environment
from aws_cdk.assertions import Template

from diopside_deployment.access_stack import GitHubDeploymentAccessStack

_IMMUTABLE_GITHUB_OIDC_SUBJECT = (
    "repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-infra"
)


def deployment_access_template(*, stack_region: str = "ap-northeast-1") -> Template:
    app = App()
    stack = GitHubDeploymentAccessStack(
        app,
        "TestDeploymentAccess",
        env=Environment(account="123456789012", region=stack_region),
    )
    return Template.from_stack(stack)


def test_deployment_role_trusts_only_the_exact_immutable_github_subject() -> None:
    template = deployment_access_template()
    template.has_parameter(
        "GitHubOidcSubject",
        {
            "Type": "String",
            "Default": _IMMUTABLE_GITHUB_OIDC_SUBJECT,
            "AllowedValues": [_IMMUTABLE_GITHUB_OIDC_SUBJECT],
        },
    )
    template.resource_count_is("AWS::IAM::OIDCProvider", 0)
    template.resource_count_is("AWS::IAM::AccessKey", 0)
    template.resource_count_is("AWS::IAM::Role", 1)

    role = next(iter(template.find_resources("AWS::IAM::Role").values()))
    trust = role["Properties"]["AssumeRolePolicyDocument"]["Statement"]
    assert trust == [
        {
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    "token.actions.githubusercontent.com:sub": {"Ref": "GitHubOidcSubject"},
                }
            },
            "Effect": "Allow",
            "Principal": {
                "Federated": {
                    "Fn::Join": [
                        "",
                        [
                            "arn:",
                            {"Ref": "AWS::Partition"},
                            ":iam::",
                            {"Ref": "AWS::AccountId"},
                            ":oidc-provider/token.actions.githubusercontent.com",
                        ],
                    ]
                }
            },
        }
    ]
    assert "repo:tsuji-tomonori/diopside-v8:" not in json.dumps(role)


def test_deployment_role_can_only_assume_required_same_environment_bootstrap_roles() -> None:
    template = deployment_access_template(stack_region="us-east-1")
    template.has_parameter(
        "TargetDeploymentRegion",
        {
            "Type": "String",
            "Default": "ap-northeast-1",
            "AllowedValues": ["ap-northeast-1"],
        },
    )
    policies = template.find_resources("AWS::IAM::Policy")
    assert len(policies) == 1
    policy = next(iter(policies.values()))
    statements = policy["Properties"]["PolicyDocument"]["Statement"]
    assert len(statements) == 1
    statement = statements[0]
    assert statement["Action"] == "sts:AssumeRole"
    assert statement["Effect"] == "Allow"
    assert statement["Sid"] == "AssumeRequiredCdkBootstrapRoles"

    resources = statement["Resource"]
    assert len(resources) == 3
    serialized = json.dumps(resources, sort_keys=True)
    assert "cdk-hnb659fds-deploy-role-" in serialized
    assert "cdk-hnb659fds-file-publishing-role-" in serialized
    assert "cdk-hnb659fds-lookup-role-" in serialized
    assert '"Ref": "TargetDeploymentRegion"' in serialized
    assert "us-east-1" not in serialized
    assert "image-publishing" not in serialized
    assert '"*"' not in serialized

    template.has_output(
        "GitHubActionsDeploymentRegion",
        {"Value": {"Ref": "TargetDeploymentRegion"}},
    )
