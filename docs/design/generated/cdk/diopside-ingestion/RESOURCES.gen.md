<!-- AUTO-GENERATED. DO NOT EDIT DIRECTLY.
Generate: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output>`
Check: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output> --check`
-->

# CloudFormation resources

| Logical ID | Type | Condition | DependsOn |
|---|---|---|---|
| `AccessLogBucketDA470295` | `AWS::S3::Bucket` | - | - |
| `AccessLogBucketPolicyF52D2D01` | `AWS::S3::BucketPolicy` | - | - |
| `RawMaterialBucketB8C67129` | `AWS::S3::Bucket` | - | - |
| `RawMaterialBucketPolicyCCCFC5BF` | `AWS::S3::BucketPolicy` | - | - |
| `RequestDeadLetterQueue4F2E4728` | `AWS::SQS::Queue` | - | - |
| `RequestDeadLetterQueuePolicy37A510D3` | `AWS::SQS::QueuePolicy` | - | - |
| `RequestQueueEA127976` | `AWS::SQS::Queue` | - | - |
| `RequestQueueEventSource` | `AWS::Lambda::EventSourceMapping` | - | - |
| `RequestQueuePolicyD374EC54` | `AWS::SQS::QueuePolicy` | - | - |
| `VideoIngestion9A244137` | `AWS::DynamoDB::Table` | - | - |
| `Worker11F36D0F` | `AWS::Lambda::Function` | - | WorkerRoleDefaultPolicy1750E153, WorkerRole8DD27D41 |
| `WorkerLogGroup31FDBE4A` | `AWS::Logs::LogGroup` | - | - |
| `WorkerRole8DD27D41` | `AWS::IAM::Role` | - | - |
| `WorkerRoleDefaultPolicy1750E153` | `AWS::IAM::Policy` | - | - |
