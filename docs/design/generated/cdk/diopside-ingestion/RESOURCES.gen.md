<!-- AUTO-GENERATED. DO NOT EDIT DIRECTLY.
Generate: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output>`
Check: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output> --check`
-->

# CloudFormation resources

| Logical ID | Type | Condition | DependsOn |
|---|---|---|---|
| `AccessLogBucketDA470295` | `AWS::S3::Bucket` | - | - |
| `AccessLogBucketPolicyF52D2D01` | `AWS::S3::BucketPolicy` | - | - |
| `BatchResultRuleAllowEventRuleDiopsideIngestionStackResultHandler44F603B077E8DABA` | `AWS::Lambda::Permission` | - | - |
| `BatchResultRuleC698CCA3` | `AWS::Events::Rule` | - | - |
| `BatchServiceRole57930367` | `AWS::IAM::Role` | - | - |
| `CDKMetadata` | `AWS::CDK::Metadata` | CDKMetadataAvailable | - |
| `DispatcherD4A12972` | `AWS::Lambda::Function` | - | DispatcherRoleDefaultPolicy0E461FA5, DispatcherRoleBDE14D07 |
| `DispatcherLogGroupB99EDF3E` | `AWS::Logs::LogGroup` | - | - |
| `DispatcherRoleBDE14D07` | `AWS::IAM::Role` | - | - |
| `DispatcherRoleDefaultPolicy0E461FA5` | `AWS::IAM::Policy` | - | - |
| `FargateComputeEnvironment` | `AWS::Batch::ComputeEnvironment` | - | BatchServiceRole57930367 |
| `IngestionEncryptionKey04A5D86F` | `AWS::KMS::Key` | - | - |
| `IngestionEncryptionKeyAlias0D2140E6` | `AWS::KMS::Alias` | - | - |
| `RawMaterialBucketB8C67129` | `AWS::S3::Bucket` | - | - |
| `RawMaterialBucketPolicyCCCFC5BF` | `AWS::S3::BucketPolicy` | - | - |
| `RequestDeadLetterQueue4F2E4728` | `AWS::SQS::Queue` | - | - |
| `RequestDeadLetterQueuePolicy37A510D3` | `AWS::SQS::QueuePolicy` | - | - |
| `RequestQueueEA127976` | `AWS::SQS::Queue` | - | - |
| `RequestQueueEventSource` | `AWS::Lambda::EventSourceMapping` | - | - |
| `RequestQueuePolicyD374EC54` | `AWS::SQS::QueuePolicy` | - | - |
| `ResultHandler8CE72AD4` | `AWS::Lambda::Function` | - | ResultRoleDefaultPolicy7B861130, ResultRoleA2B2B471 |
| `ResultLogGroup752C53EB` | `AWS::Logs::LogGroup` | - | - |
| `ResultRoleA2B2B471` | `AWS::IAM::Role` | - | - |
| `ResultRoleDefaultPolicy7B861130` | `AWS::IAM::Policy` | - | - |
| `VideoIngestion9A244137` | `AWS::DynamoDB::Table` | - | - |
| `WorkerExecutionRole8A72FF4F` | `AWS::IAM::Role` | - | - |
| `WorkerExecutionRoleDefaultPolicy2AE0C78C` | `AWS::IAM::Policy` | - | - |
| `WorkerJobDefinition` | `AWS::Batch::JobDefinition` | - | - |
| `WorkerJobQueue` | `AWS::Batch::JobQueue` | - | FargateComputeEnvironment |
| `WorkerJobRole890EB09D` | `AWS::IAM::Role` | - | - |
| `WorkerJobRoleDefaultPolicyC4E5ADCE` | `AWS::IAM::Policy` | - | - |
| `WorkerLogGroup31FDBE4A` | `AWS::Logs::LogGroup` | - | - |
| `WorkerRepository770852D6` | `AWS::ECR::Repository` | - | - |
| `WorkerSecurityGroup5529CF0B` | `AWS::EC2::SecurityGroup` | - | - |
| `WorkerVpcA12AC6F9` | `AWS::EC2::VPC` | - | - |
| `WorkerVpcFlowLog` | `AWS::EC2::FlowLog` | - | - |
| `WorkerVpcFlowLogGroupF54C2747` | `AWS::Logs::LogGroup` | - | - |
| `WorkerVpcFlowLogRole3DFC0D50` | `AWS::IAM::Role` | - | - |
| `WorkerVpcFlowLogRoleDefaultPolicy8BB665FD` | `AWS::IAM::Policy` | - | - |
| `WorkerVpcIGWC2B94A1A` | `AWS::EC2::InternetGateway` | - | - |
| `WorkerVpcVPCGWDDC7E69B` | `AWS::EC2::VPCGatewayAttachment` | - | - |
| `WorkerVpcpublicworkerSubnet1DefaultRoute78D4EF4E` | `AWS::EC2::Route` | - | WorkerVpcVPCGWDDC7E69B |
| `WorkerVpcpublicworkerSubnet1RouteTableA74FB330` | `AWS::EC2::RouteTable` | - | - |
| `WorkerVpcpublicworkerSubnet1RouteTableAssociation317510C9` | `AWS::EC2::SubnetRouteTableAssociation` | - | - |
| `WorkerVpcpublicworkerSubnet1Subnet37E39F3A` | `AWS::EC2::Subnet` | - | - |
| `WorkerVpcpublicworkerSubnet2DefaultRoute273B2FF7` | `AWS::EC2::Route` | - | WorkerVpcVPCGWDDC7E69B |
| `WorkerVpcpublicworkerSubnet2RouteTable9D273F1C` | `AWS::EC2::RouteTable` | - | - |
| `WorkerVpcpublicworkerSubnet2RouteTableAssociation95202DE8` | `AWS::EC2::SubnetRouteTableAssociation` | - | - |
| `WorkerVpcpublicworkerSubnet2Subnet073D8779` | `AWS::EC2::Subnet` | - | - |
