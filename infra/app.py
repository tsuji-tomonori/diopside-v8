#!/usr/bin/env python3
"""Synthesize the one-off historical material ingestion stack."""

from aws_cdk import App, Aspects
from cdk_nag import AwsSolutionsChecks

from diopside_ingestion.stack import IngestionStack

app = App()
IngestionStack(app, "DiopsideIngestionStack")
Aspects.of(app).add(AwsSolutionsChecks(verbose=True))
app.synth()
