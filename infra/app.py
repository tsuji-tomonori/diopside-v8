#!/usr/bin/env python3
"""Synthesize the one-off historical material ingestion stack."""

from aws_cdk import App, Aspects
from cdk_nag import AwsSolutionsChecks

from diopside_ingestion.lambda_asset import bundled_lambda_source
from diopside_ingestion.stack import IngestionStack

app = App()
with bundled_lambda_source() as lambda_source_directory:
    IngestionStack(
        app,
        "DiopsideIngestionStack",
        lambda_source_directory=lambda_source_directory,
    )
    Aspects.of(app).add(AwsSolutionsChecks(verbose=True))
    app.synth()
