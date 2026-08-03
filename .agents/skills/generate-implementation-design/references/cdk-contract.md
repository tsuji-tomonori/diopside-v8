# AWS CDK implementation-to-design contract

1. Build and test the CDK application.
2. Run `cdk synth`; AWS documents that this produces a CloudFormation template for each stack.
3. Feed the synthesized YAML/JSON, not handwritten architecture prose, to `designflow.py cdk`.
4. Generate resource type/logical-ID inventory and parameter type/default/allowed-values/description.
5. Trace canonical requirement IDs to constructs or synthesized logical IDs and tests.
6. Keep manual architecture decisions separate from generated implementation detail.

The manifest binds generated documentation to the exact template bytes. Logical-ID or property changes therefore invalidate `--check` until regeneration.

Primary references: [AWS CDK synthesis](https://docs.aws.amazon.com/cdk/v2/guide/configure-synth.html) and [CloudFormation template sections](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-anatomy.html).
