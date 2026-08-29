#!/usr/bin/env python3
"""Synthesize the one-off historical material ingestion stack."""

import os

from aws_cdk import App, Aspects, BootstraplessSynthesizer, Environment
from cdk_nag import AwsSolutionsChecks

from diopside_deployment.access_stack import GitHubDeploymentAccessStack
from diopside_ingestion.lambda_asset import bundled_lambda_source
from diopside_ingestion.stack import IngestionStack


def deployment_environment() -> Environment | None:
    """Use an explicit account and Region together when deployment supplies both."""
    account = os.environ.get("CDK_DEFAULT_ACCOUNT")
    region = os.environ.get("CDK_DEFAULT_REGION")
    if account is None or region is None:
        return None
    return Environment(account=account, region=region)


app = App()
environment = deployment_environment()
with bundled_lambda_source() as lambda_source_directory:
    IngestionStack(
        app,
        "DiopsideIngestionStack",
        lambda_source_directory=lambda_source_directory,
        env=environment,
    )
    GitHubDeploymentAccessStack(
        app,
        "DiopsideGitHubDeploymentAccessStack",
        env=environment,
        synthesizer=BootstraplessSynthesizer(),
    )
    Aspects.of(app).add(AwsSolutionsChecks(verbose=True))
    app.synth()
