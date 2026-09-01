---
title: 【SageMaker Unified Studio】Zero-ETL 統合ターゲット Redshift タイプ Glue カタログに対してアセットを作成する
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - Redshift
  - ZeroETL
private: false
updated_at: '2026-08-31T23:59:05+09:00'
id: null
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

本記事は、AWS CLI で Redshift タイプの Glue カタログに対してアセットを作成する手順をまとめた記事です。

そもそも「アセット」とは何か、ドメイン・プロジェクト・アセットの関係性、なぜアセットが必要なのかといった概念については、以下の記事にまとめてます。

👉 [SageMaker Unified Studio におけるデータ活用・ガバナンスの肝「アセット」を深掘りしてみる](https://qiita.com/swkky/items/092df5056ee13b7a9297)

本記事では **Zero-ETL 統合ターゲットに指定可能な Redshift タイプの Glue カタログ**に属するテーブルをアセット化する手順を扱います。  
現時点で、RDS のゼロ ETL 統合では、ターゲットとして以下の 2 種類しか選択できず、S3 を直接ターゲットに出来ません。 
そのため、Unified Studio のカタログと統合する場合、**Redshift Managed Storage 経由**で Glue カタログに連携する必要があります。

| ターゲット | 概要 |
|-----------|------|
| **Glue データカタログ（Redshift 型カタログ）** | Glue カタログ経由で Redshift Serverless にデータが格納される。SageMaker Unified Studio との統合に適する |
| **Redshift（直接）** | Redshift Provisioned / Serverless を直接ターゲットに指定する。従来からある方式 |

### この記事で解説すること

- 通常の Glue テーブルとのアセット作成手順の違い
- `--type GLUE` でサブカタログを指定してデータソースを作成する方法

## 対象アーキテクチャ

```
Aurora（RDS）クラスター（ソースアカウント）
    │  Zero-ETL 統合（CDC）
    ▼
Glue カタログ: <ターゲットカタログ名>（ターゲットアカウント、aws:redshift タイプ）
    │  └─ サブカタログ（統合IDごとに自動生成）
    │       └─ Redshift Managed Storage
    ▼
SageMaker Unified Studio からアセット化・クエリ
```

Aurora の Zero-ETL 統合では、ターゲットに指定した Glue カタログ（本記事では `<ターゲットカタログ名>` と表記）の配下に、**統合ごとにサブカタログが自動生成**されます。

```
<ターゲットカタログ名>（親カタログ, aws:redshift）
├── zetl_<統合ID>_<DB名>        ← PostgreSQL 統合のサブカタログ
│   └── zetl_default            ← テーブルが入るデータベース
├── zetl_<統合ID>              ← MySQL 統合のサブカタログ
│   └── <実DB名>               ← テーブルが入るデータベース（ソースの DB 名）
└── ...
```

:::note info
PostgreSQL 統合ではテーブルが **`zetl_default`** というデータベース配下に、MySQL 統合では**ソースの実 DB 名**配下に格納されます。`public` は空になります。
:::

## 通常の Glue テーブルとの違い

| 観点 | 通常の Glue テーブル（前回記事） | Zero-ETL の Redshift カタログ（本記事） |
|------|------------------------------|----------------------------------------|
| カタログ | AWS アカウントのデフォルト Glue カタログ | `<ターゲットカタログ名>` 配下の**サブカタログ** |
| `catalogName` | AWS アカウント ID | `<アカウントID>:<ターゲットカタログ名>/<サブカタログID>` |
| データソース type | `GLUE` | **`GLUE`**（Redshift タイプでも GLUE で作成するのがポイント） |
| データ実体 | S3 | Redshift Managed Storage |

**ポイント**: ターゲットが Redshift タイプのカタログでも、データソースは **`--type GLUE`** で作成し、`catalogName` にサブカタログを指定します。

## 前提条件

- SageMaker Unified Studio ドメイン（IdC ベース / V2）が作成済み
- 対象プロジェクトが存在し、ターゲットカタログに紐づく Glue 接続が設定済み
- Aurora の Zero-ETL 統合が作成済みで、ターゲット Glue カタログ配下にサブカタログ・テーブルが生成されていること
- **Zero-ETL 統合のセットアップ時に、ターゲット Glue カタログが Lake Formation の権限管理下に設定済みであること**（`AWSServiceRoleForRedshift` を read-only の Lake Formation 管理者として登録する等。詳細は [Amazon RDS zero-ETL integration with Amazon SageMaker lakehouse](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/zero-etl.creating-smlh.html)）
- アセットを作成するプロジェクトのデータアクセスロールが、対象サブカタログ/データベース/テーブルへの Lake Formation 権限（`DESCRIBE` / `SELECT` 相当）を持つこと

## 全体フロー

```
1. サブカタログ ID を確認
2. create-data-source（--type GLUE, catalogName にサブカタログを指定）
3. get-data-source          → READY を確認
4. start-data-source-run    → メタデータをスキャン
5. get-data-source-run      → SUCCESS を確認
6. search (ASSET)           → アセット作成を確認
```

## Step 0: サブカタログ ID の確認

親カタログ配下のサブカタログを一覧します。

```bash
aws glue get-catalogs \
  --parent-catalog-id "<アカウントID>:<ターゲットカタログ名>" \
  --region ap-northeast-1 \
  --query 'CatalogList[].Name'
```

**出力例:**
```json
[
  "zetl_<統合ID-A>",            // MySQL 統合
  "zetl_<統合ID-B>_postgres",   // PostgreSQL 統合
  ...
]
```

各サブカタログ内のデータベース（`zetl_default` or 実 DB 名）も確認しておきます。

```bash
aws glue get-databases \
  --catalog-id "<アカウントID>:<ターゲットカタログ名>/<サブカタログID>" \
  --region ap-northeast-1 \
  --query 'DatabaseList[].Name'
```

## Step 1: 事前確認 — プロジェクトの接続 ID

Zero-ETL のターゲットカタログに紐づく Glue 接続の ID を確認します。

```bash
aws datazone list-connections \
  --domain-identifier <ドメインID> \
  --project-identifier <プロジェクトID> \
  --region ap-northeast-1
```

ターゲットカタログに紐づく `GLUE_CONNECTION`（`"status": "READY"`）の `connectionId` を控えます。

## 補足: Redshift 経由でクエリ・検証したい場合

アセット作成自体は `--type GLUE` で完結しますが、Redshift Data API を使って取り込んだデータをクエリ・検証したい場合は、プロジェクトの**データアクセスロール**（`datazone_usr_role_<プロジェクトID>_<サフィックス>`）に以下の権限を付与しておくとよいです。

```json
{
  "Effect": "Allow",
  "Action": [
    "redshift-data:ListDatabases", "redshift-data:ListSchemas",
    "redshift-data:ListTables", "redshift-data:DescribeTable",
    "redshift-data:ExecuteStatement", "redshift-data:DescribeStatement",
    "redshift-data:GetStatementResult"
  ],
  "Resource": "*"
}
```

## Step 2: データソースの作成（--type GLUE）

MySQL 統合（実 DB 名が `<実DB名>` の例）:

```bash
aws datazone create-data-source \
  --domain-identifier <ドメインID> \
  --project-identifier <プロジェクトID> \
  --name "zetl-<任意の名前>-glue" \
  --type GLUE \
  --connection-identifier <接続ID> \
  --configuration '{
    "glueRunConfiguration": {
      "catalogName": "<アカウントID>:<ターゲットカタログ名>/<サブカタログID>",
      "relationalFilterConfigurations": [{
        "databaseName": "<実DB名>",
        "filterExpressions": [{"type": "INCLUDE", "expression": "*"}]
      }]
    }
  }' \
  --recommendation '{"enableBusinessNameGeneration": false}' \
  --enable-setting ENABLED \
  --no-publish-on-import \
  --region ap-northeast-1
```

PostgreSQL 統合の場合は `databaseName` を **`zetl_default`** にします。

```bash
    ...
      "catalogName": "<アカウントID>:<ターゲットカタログ名>/<サブカタログID>",
      "relationalFilterConfigurations": [{
        "databaseName": "zetl_default",
        "filterExpressions": [{"type": "INCLUDE", "expression": "*"}]
      }]
    ...
```

#### 主要パラメータ

| パラメータ | 説明 |
|-----------|------|
| `--type` | **`GLUE`**（Redshift タイプのカタログでも GLUE で作成） |
| `catalogName` | `<アカウントID>:<ターゲットカタログ名>/<サブカタログID>` |
| `databaseName` | PostgreSQL 統合 → `zetl_default`、MySQL 統合 → 実 DB 名 |
| `filterExpressions` | 取り込むテーブル（`*` で全テーブル） |
| `--no-publish-on-import` | 取り込み時にカタログへ自動パブリッシュしない |

## Step 3: ステータス確認（READY）

```bash
aws datazone get-data-source \
  --domain-identifier <ドメインID> \
  --identifier <データソースID> \
  --region ap-northeast-1 \
  --query 'status'
```

`"READY"` になれば成功です。

## Step 4: データソースランの実行

```bash
aws datazone start-data-source-run \
  --domain-identifier <ドメインID> \
  --data-source-identifier <データソースID> \
  --region ap-northeast-1
```

## Step 5: ランの結果確認

```bash
aws datazone get-data-source-run \
  --domain-identifier <ドメインID> \
  --identifier <ランID> \
  --region ap-northeast-1 \
  --query '{status:status, stats:runStatisticsForAssets}'
```

**成功時の出力例:**
```json
{
  "status": "SUCCESS",
  "stats": { "added": 4, "updated": 0, "unchanged": 0, "failed": 0 }
}
```

## Step 6: 作成されたアセットの確認

```bash
aws datazone search \
  --domain-identifier <ドメインID> \
  --owning-project-identifier <プロジェクトID> \
  --search-scope ASSET \
  --search-text "<テーブル名>" \
  --region ap-northeast-1 \
  --query 'items[].assetItem.{name:name, ext:externalIdentifier}'
```

**出力例:**
```json
[
  {
    "name": "<テーブル名>",
    "ext": "arn:aws:glue:ap-northeast-1:<アカウントID>:table/<ターゲットカタログ名>/<サブカタログID>/<DB名>/<テーブル名>.<プロジェクトID>"
  }
]
```

`externalIdentifier` が `table/<ターゲットカタログ名>/<サブカタログID>/<DB名>/<テーブル名>.<プロジェクトID>` の形式になっている点が、通常の Glue テーブル（`table/<DB名>/<テーブル名>...`）との違いです。

## まとめ

- Zero-ETL 統合ターゲットである **Redshift タイプの Glue カタログ**でも、アセット作成は **`--type GLUE`** でサブカタログを `catalogName` に指定する。
- `catalogName` は `<アカウントID>:<ターゲットカタログ名>/<サブカタログID>`、`databaseName` は PostgreSQL 統合なら `zetl_default`、MySQL 統合なら実 DB 名。

アセット作成後は、ビジネスメタデータ（ビジネス名・Description・グロサリー・メタデータフォームなど）を付与していきます。

## 参考

- [Create an Amazon SageMaker Unified Studio data source for AWS Glue in the project catalog](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-source-glue.html)
- [Aurora zero-ETL integrations with Amazon Redshift](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/zero-etl.html)
- [【SageMaker Unified Studio 入門】「アセットってなに？」を理解して、AWS CLI から作成してみる](https://qiita.com/swkky/items/092df5056ee13b7a9297)
