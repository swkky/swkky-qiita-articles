---
title: 【クロスアカウント】DynamoDB Zero-ETL → S3（Iceberg）ターゲットの構築手順と注意点
tags:
  - AWS
  - DynamoDB
  - glue
  - iceberg
  - lakeformation
private: false
updated_at: '2026-08-20T17:14:38+09:00'
id: 4b4a0df5158153233a22
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
## はじめに

DynamoDB の Zero-ETL 統合で、ターゲットを **General Purpose S3 バケット（Apache Iceberg 形式）** にする構成を**クロスアカウント**で構築しました。

実際に動作確認が取れた設定手順をまとめます。

### 構成図

```
[ソースアカウント A]                        [ターゲットアカウント B]
DynamoDB テーブル                           Glue Database (LocationUri=S3)
  │                                           │
  └── CreateIntegration API ──────────────────┘
        (ソースアカウントから実行)               ↓
                                           S3 バケット
                                           (Iceberg テーブル自動作成)
                                               ↓
                                           Athena / SageMaker Unified Studio
```

### 前提

- ソースアカウント（A）: DynamoDB テーブルが存在するアカウント
- ターゲットアカウント（B）: Glue Database + S3 バケットが存在するアカウント
- クロスアカウント統合（A ≠ B）
- Terraform（awscc プロバイダー）で統合を管理

---

## ターゲットアカウント（B）での設定

統合作成**前に**全て完了しておく必要があります。

### 1. Glue Database の作成

```bash
aws glue create-database \
  --database-input '{
    "Name": "my_zero_etl_database",
    "LocationUri": "s3://my-bucket/path/to/iceberg/"
  }' \
  --region ap-northeast-1
```

:::note alert
**Database 名にハイフン（`-`）は使用不可。** `my-database` のような名前で作成すると、統合作成時に `contains invalid characters` エラーになります。アンダースコア（`_`）を使ってください。
:::

:::note
`LocationUri` は**必須**。設定されていない Database は Zero-ETL ターゲットとして使用できません。
:::

### 2. Integration Resource Property の作成

ターゲット IAM ロールを Glue Database に紐付けます。

```bash
aws glue create-integration-resource-property \
  --resource-arn "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database" \
  --target-processing-properties '{"RoleArn": "arn:aws:iam::<account_B>:role/ZeroETLTargetRole"}' \
  --region ap-northeast-1
```

確認:
```bash
aws glue get-integration-resource-property \
  --resource-arn "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database" \
  --region ap-northeast-1
```

### 3. Lake Formation 権限の設定

SageMaker Unified Studio（DataZone）を有効化した環境では、Lake Formation の権限モデルが適用されています（`CreateDatabaseDefaultPermissions: []`）。この場合、IAM ポリシーだけではアクセスできず、明示的な Lake Formation 権限付与が必要です。

:::note alert
Lake Formation の権限設定が不足していると、統合が `NEEDS_ATTENTION` 状態になり以下のエラーが出ます:
> Authorization failed because the target role does not have access to the target database due to Lake Formation permissions.
:::

#### 3-1. Database 権限

```bash
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<account_B>:role/ZeroETLTargetRole"}' \
  --resource '{"Database": {"Name": "my_zero_etl_database"}}' \
  --permissions ALL \
  --permissions-with-grant-option ALL \
  --region ap-northeast-1
```

#### 3-2. Table 権限（全テーブル）

```bash
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<account_B>:role/ZeroETLTargetRole"}' \
  --resource '{"Table": {"DatabaseName": "my_zero_etl_database", "TableWildcard": {}}}' \
  --permissions ALL \
  --permissions-with-grant-option ALL \
  --region ap-northeast-1
```

#### 3-3. Data Location アクセス

```bash
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<account_B>:role/ZeroETLTargetRole"}' \
  --resource '{"DataLocation": {"ResourceArn": "arn:aws:s3:::my-bucket/s3_path"}}' \
  --permissions DATA_LOCATION_ACCESS \
  --region ap-northeast-1
```

#### 3-4. （SageMaker Unified Studio 利用時）プロジェクトロールへの権限付与

SageMaker Unified Studio のプロジェクトから Glue テーブルを参照するには、プロジェクトに紐づく DataZone ユーザーロールにも権限が必要です。

```bash
# プロジェクトロール名の確認
aws iam list-roles \
  --query "Roles[?starts_with(RoleName, 'datazone_usr_role_<project_id>')].[RoleName]" \
  --output text

# Database 権限
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<account_B>:role/datazone_usr_role_<project_id>_<suffix>"}' \
  --resource '{"Database": {"Name": "my_zero_etl_database"}}' \
  --permissions ALL --permissions-with-grant-option ALL \
  --region ap-northeast-1

# Table 権限
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<account_B>:role/datazone_usr_role_<project_id>_<suffix>"}' \
  --resource '{"Table": {"DatabaseName": "my_zero_etl_database", "TableWildcard": {}}}' \
  --permissions ALL --permissions-with-grant-option ALL \
  --region ap-northeast-1
```

:::note alert
この設定が無いと、Athena からは直接クエリ可能なのに SageMaker Unified Studio の UI ではデータベースが表示されない、という状態になります。
:::

### 4. Catalog RBAC ポリシーの設定

Glue Data Catalog のリソースポリシーに、ソースアカウントからの統合作成を許可します。

```bash
aws glue get-resource-policy --region ap-northeast-1  # 既存ポリシーを確認
```

**既存の Statement 配列に以下を追加して `put-resource-policy`:**

```json
{
  "Sid": "AllowSourceCreateInbound",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::<account_A>:root"
  },
  "Action": "glue:CreateInboundIntegration",
  "Resource": [
    "arn:aws:glue:ap-northeast-1:<account_B>:catalog",
    "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database"
  ],
  "Condition": {
    "StringEquals": {
      "aws:SourceArn": "arn:aws:dynamodb:ap-northeast-1:<account_A>:table/my_source_table"
    }
  }
},
{
  "Sid": "AllowGlueServiceAuthorize",
  "Effect": "Allow",
  "Principal": {
    "Service": "glue.amazonaws.com"
  },
  "Action": "glue:AuthorizeInboundIntegration",
  "Resource": [
    "arn:aws:glue:ap-northeast-1:<account_B>:catalog",
    "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database"
  ],
  "Condition": {
    "StringEquals": {
      "aws:SourceArn": "arn:aws:dynamodb:ap-northeast-1:<account_A>:table/my_source_table"
    }
  }
}
```

:::note alert
既存のポリシーを上書きしないこと。`get-resource-policy` で取得した JSON の `Statement` 配列にマージしてから `put-resource-policy` を実行してください。
:::

### 5. （任意）Integration Table Properties の設定

デフォルト（`FULL` unnest + PK バケッティング）以外を使いたい場合のみ。

```bash
aws glue create-integration-table-properties \
  --resource-arn "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database" \
  --table-name "my_source_table" \
  --target-table-config '{"UnnestSpec": "TOPLEVEL", "TargetTableName": "my_target_table"}' \
  --region ap-northeast-1
```

:::note
クロスアカウントの場合、この API は**ターゲットアカウントから**実行する必要があります。AWS Glue Console の自動設定（Fix it for me）はクロスアカウントでは使えません。
:::

### ターゲット IAM ロールに必要な権限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-bucket"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::my-bucket/path/*"
    },
    {
      "Effect": "Allow",
      "Action": ["glue:GetCatalog", "glue:GetDatabase", "glue:GetDatabases",
                 "glue:CreateTable", "glue:GetTable", "glue:GetTables",
                 "glue:DeleteTable", "glue:UpdateTable",
                 "glue:GetTableVersion", "glue:GetTableVersions",
                 "glue:GetResourcePolicy", "glue:CreatePartition",
                 "glue:BatchCreatePartition", "glue:DeletePartition", "glue:GetPartition", "glue:GetPartitions"],
      "Resource": ["arn:aws:glue:ap-northeast-1:<account_B>:catalog",
                   "arn:aws:glue:ap-northeast-1:<account_B>:database/*",
                   "arn:aws:glue:ap-northeast-1:<account_B>:table/*/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "lakeformation:GetDataAccess",
      "Resource": "*"
    }
  ]
}
```

信頼ポリシー:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "glue.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

---

## ソースアカウント（A）での設定

### 1. DynamoDB テーブルの PITR 有効化

```bash
aws dynamodb update-continuous-backups \
  --table-name "my_source_table" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region ap-northeast-1
```

### 2. DynamoDB テーブルのリソースポリシー設定

```bash
aws dynamodb put-resource-policy \
  --resource-arn "arn:aws:dynamodb:ap-northeast-1:<account_A>:table/my_source_table" \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AllowGlueZeroETL",
        "Effect": "Allow",
        "Principal": { "Service": "glue.amazonaws.com" },
        "Action": [
          "dynamodb:ExportTableToPointInTime",
          "dynamodb:DescribeTable",
          "dynamodb:DescribeExport"
        ],
        "Resource": "*",
        "Condition": {
          "StringEquals": { "aws:SourceAccount": "<account_A>" },
          "ArnLike": { "aws:SourceArn": "arn:aws:glue:ap-northeast-1:<account_A>:integration:*" }
        }
      }
    ]
  }' \
  --region ap-northeast-1
```

### 3. Zero-ETL 統合の作成

ターゲット側の設定が**全て完了した後**に実行します。

#### CLI の場合

```bash
aws glue create-integration \
  --integration-name "my-zero-etl-integration" \
  --source-arn "arn:aws:dynamodb:ap-northeast-1:<account_A>:table/my_source_table" \
  --target-arn "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database" \
  --description "DynamoDB to S3 Iceberg via Zero-ETL" \
  --integration-config '{"RefreshInterval": "15"}' \
  --region ap-northeast-1
```

#### Terraform（awscc プロバイダー）の場合

```hcl
resource "awscc_glue_integration" "dynamodb" {
  integration_name = "my-zero-etl-integration"
  source_arn       = "arn:aws:dynamodb:ap-northeast-1:<account_A>:table/my_source_table"
  target_arn       = "arn:aws:glue:ap-northeast-1:<account_B>:database/my_zero_etl_database"
  description      = "DynamoDB to S3 Iceberg via Zero-ETL"

  integration_config = {
    refresh_interval = "15"
  }
}
```

:::note
`target_arn` には **Glue Database ARN** を指定します（Catalog ARN ではありません）。
:::

---

## 実行順序まとめ

```
1. [ターゲット B] Glue Database 作成（LocationUri 付き）
2. [ターゲット B] Integration Resource Property 作成（IAM ロール紐付け）
3. [ターゲット B] Lake Formation 権限設定（Database + Table + Data Location）
4. [ターゲット B] Catalog RBAC ポリシー設定
5. [ターゲット B] (任意) Integration Table Properties 設定
6. [ソース A]     DynamoDB PITR 有効化
7. [ソース A]     DynamoDB リソースポリシー設定
8. [ソース A]     Zero-ETL 統合作成（CreateIntegration）
```

:::note alert
クロスアカウントでは **「Fix it for me」オプションは使用不可**。全て手動設定が必要です。
:::

---

## 自動作成される Iceberg テーブル

統合が `ACTIVE` になると、初回 Full Export 後にターゲット Glue Database 配下に **Iceberg テーブルが自動作成**されます（数分〜10分程度）。

### テーブルプロパティ例

```json
{
  "Table": {
    "Name": "my_source_table",
    "DatabaseName": "my_zero_etl_database",
    "TableType": "EXTERNAL_TABLE",
    "Parameters": {
      "table_type": "ICEBERG",
      "metadata_location": "s3://my-bucket/path/to/iceberg/metadata/00005-xxx.metadata.json",
      "glue_integration_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx_xxxxxxxxxxxxxxxx"
    },
    "StorageDescriptor": {
      "Columns": [
        { "Name": "sk",   "Type": "string", "Parameters": { "iceberg.field.id": "1", "iceberg.field.optional": "true" } },
        { "Name": "pk",   "Type": "string", "Parameters": { "iceberg.field.id": "2", "iceberg.field.optional": "true" } },
        { "Name": "att1", "Type": "string", "Parameters": { "iceberg.field.id": "3", "iceberg.field.optional": "true" } }
      ],
      "Location": "s3://my-bucket/path/to/iceberg/"
    },
    "CreatedBy": "arn:aws:sts::<account_B>:assumed-role/ZeroETLTargetRole/customer-role-session-xxx"
  }
}
```

特徴:
- `table_type: ICEBERG` — Apache Iceberg テーブルとして登録される
- `metadata_location` — Iceberg メタデータファイルの S3 パス
- `glue_integration_id` — Zero-ETL 統合との紐付け ID
- `CreatedBy` — ターゲットロールが AssumeRole して自動作成
- カラムは DynamoDB の属性から自動検出され、`iceberg.field.id` が振られる
- PK/SK もカラムとして展開される（TOPLEVEL / FULL unnest 時）

### S3 上のディレクトリ構造

```
s3://my-bucket/path/to/iceberg/
  ├── data/           ← Parquet データファイル
  └── metadata/       ← Iceberg メタデータ（JSON + Avro manifest）
```

---

## ハマりポイントまとめ

| # | 問題 | 原因 | 解決策 |
|---|------|------|--------|
| 1 | `contains invalid characters` | Glue Database 名にハイフン | **アンダースコアを使う** |
| 2 | `not authorized to perform: glue:CreateInboundIntegration` | Catalog RBAC ポリシー未設定 | `put-resource-policy` で Statement 追加 |
| 3 | `Authorization failed ... Lake Formation permissions` | LF 権限不足 | Database ALL + Table ALL + Data Location アクセスを付与 |
| 4 | SageMaker Unified Studio で DB が見えない | DataZone プロジェクトロールに LF 権限なし | プロジェクトロールに Database + Table 権限を付与 |
| 5 | 同時削除で `another operation is in progress` | 同一ターゲットへの並行操作 | 数十秒待って再実行 |
| 6 | テーブルが自動作成されない | 初回 Full Export 処理中 | ACTIVE 後 5〜10分待つ |
| 7 | Fix it for me が使えない | クロスアカウント | 全て手動設定するしかない |

---

## RefreshInterval について

| 項目 | 値 |
|------|-----|
| デフォルト | 15 分（DynamoDB ソースの場合） |
| 最小 | 15 分 |
| 最大 | 8640 分（6日） |
| 作成後の変更 | **S3 ターゲットの場合は可能**（`ModifyIntegration` API） |

:::note
Redshift ターゲットでは RefreshInterval は作成後に変更不可ですが、S3（Glue Database）ターゲットでは変更可能です。これは S3 ターゲットの大きなメリットです。
:::

---

## UnnestSpec（スキーマアンネスト）

DynamoDB のネスト構造をどう展開するか制御できます。

| オプション | 動作 |
|-----------|------|
| `FULL`（デフォルト） | 全ネスト構造をドット記法でフラット化 |
| `TOPLEVEL` | トップレベルのフィールドのみ展開 |
| `NOUNNEST` | PK + 1つの struct カラムに格納 |

---

## まとめ

DynamoDB Zero-ETL → S3（Iceberg）のクロスアカウント構成は、公式ドキュメントだけでは情報が不十分な箇所が多いです。特に:

1. **Lake Formation 周り**は環境（DataZone 有効/無効）によって必要な設定が大きく異なる
2. **命名規則**（ハイフン不可）はエラーメッセージからしか分からない
3. **実行順序**が厳密（ターゲット側を全て先に設定してからソース側で統合作成）

一度設定が通れば、DynamoDB のデータが自動的に Iceberg 形式で S3 に同期され、Athena や SageMaker Unified Studio からすぐにクエリできます。Redshift Serverless が不要になるためコスト削減にも有効です。

---

## 参考

- [Configuring a target for a zero-ETL integration](https://docs.aws.amazon.com/glue/latest/dg/zero-etl-target.html)
- [DynamoDB zero-ETL integration with Amazon SageMaker Lakehouse](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/amazon-sagemaker-lakehouse-for-DynamoDB-zero-etl.html)
- [Integration APIs in AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-api-integrations.html)
- [Schema unnesting](https://docs.aws.amazon.com/glue/latest/dg/zero-etl-ddb-schema-unnesting.html)
- [Configuring Refresh Interval](https://docs.aws.amazon.com/glue/latest/dg/zero-etl-configuring-integration.html)
- [Troubleshooting zero-ETL integrations](https://docs.aws.amazon.com/glue/latest/dg/zero-etl-troubleshooting.html)
