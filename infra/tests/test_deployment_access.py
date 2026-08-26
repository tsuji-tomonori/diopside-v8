from __future__ import annotations

import json

from aws_cdk import App
from aws_cdk.assertions import Template

from diopside_deployment.access_stack import GitHubDeploymentAccessStack


def deployment_access_template() -> Template:
    app = App()
    stack = GitHubDeploymentAccessStack(app, "TestDeploymentAccess")
    return Template.from_stack(stack)


def test_deployment_role_trusts_only_the_exact_protected_github_environment() -> None:
    template = deployment_access_template()
    template.has_parameter(
        "GitHubOidcSubject",
        {
            "Type": "String",
            "AllowedPattern": ("^repo:[^:]+/[^:]+:environment:private-backfill-infra$"),
        },
    )
    template.has_parameter(
        "GitHubEnqueueOidcSubject",
        {
            "Type": "String",
            "AllowedPattern": ("^repo:[^:]+/[^:]+:environment:private-backfill-enqueue$"),
        },
    )
    template.resource_count_is("AWS::IAM::OIDCProvider", 0)
    template.resource_count_is("AWS::IAM::AccessKey", 0)
    template.resource_count_is("AWS::IAM::Role", 2)

    roles = template.find_resources("AWS::IAM::Role")
    role_by_name = {role["Properties"]["RoleName"]: role for role in roles.values()}
    assert set(role_by_name) == {
        "diopside-github-actions-deploy",
        "diopside-github-actions-enqueue",
    }
    for role_name, subject_parameter in [
        ("diopside-github-actions-deploy", "GitHubOidcSubject"),
        ("diopside-github-actions-enqueue", "GitHubEnqueueOidcSubject"),
    ]:
        trust = role_by_name[role_name]["Properties"]["AssumeRolePolicyDocument"]["Statement"]
        assert trust == [
            {
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                        "token.actions.githubusercontent.com:sub": {"Ref": subject_parameter},
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


def test_deployment_role_can_only_assume_required_same_environment_bootstrap_roles() -> None:
    template = deployment_access_template()
    role_ids_by_name = {
        role["Properties"]["RoleName"]: logical_id
        for logical_id, role in template.find_resources("AWS::IAM::Role").items()
    }
    policies = template.find_resources("AWS::IAM::Policy")
    assert len(policies) == 2
    policy = next(
        policy
        for policy in policies.values()
        if "sts:AssumeRole" in json.dumps(policy, sort_keys=True)
    )
    assert policy["Properties"]["Roles"] == [
        {"Ref": role_ids_by_name["diopside-github-actions-deploy"]}
    ]
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
    assert "image-publishing" not in serialized
    assert '"*"' not in serialized


def test_enqueue_role_can_only_send_to_the_private_ingestion_request_queue() -> None:
    template = deployment_access_template()
    role_ids_by_name = {
        role["Properties"]["RoleName"]: logical_id
        for logical_id, role in template.find_resources("AWS::IAM::Role").items()
    }
    policies = template.find_resources("AWS::IAM::Policy")
    policy = next(
        policy
        for policy in policies.values()
        if "sqs:SendMessage" in json.dumps(policy, sort_keys=True)
    )
    assert policy["Properties"]["Roles"] == [
        {"Ref": role_ids_by_name["diopside-github-actions-enqueue"]}
    ]
    statements = policy["Properties"]["PolicyDocument"]["Statement"]
    assert statements == [
        {
            "Action": "sqs:SendMessage",
            "Effect": "Allow",
            "Resource": {
                "Fn::Join": [
                    "",
                    [
                        "arn:",
                        {"Ref": "AWS::Partition"},
                        ":sqs:",
                        {"Ref": "AWS::Region"},
                        ":",
                        {"Ref": "AWS::AccountId"},
                        ":diopside-ingestion-request.fifo",
                    ],
                ]
            },
            "Sid": "SendOnlyToIngestionRequestQueue",
        }
    ]
    serialized = json.dumps(policy, sort_keys=True)
    assert '"*"' not in serialized
    assert "s3:" not in serialized.lower()
    assert "dynamodb:" not in serialized.lower()
    assert "lambda:" not in serialized.lower()
    assert "cloudformation:" not in serialized.lower()
