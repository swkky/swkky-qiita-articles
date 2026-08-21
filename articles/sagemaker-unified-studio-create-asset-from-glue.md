---
title: "SageMaker Unified Studio で Glue テーブルのアセットを作成する手順"
emoji: "📦"
type: "tech"
topics: ["AWS", "SageMakerUnifiedStudio", "DataZone", "Glue", "DataCatalog"]
published: true
---

## アセットとは?

SageMaker Unified Studio（DataZone）における「アセット」とは、テーブルやビューなどの**データオブジェクト1つに対応するカタログ上の管理単位**です。

- Glue テーブル 1 つ = アセット 1 つ
- アセットにはビジネス名、説明、グロサリー用語、メタデータフォーム等のビジネスコンテキストを付与できる
- パブリッシュするとドメイン全体のユーザーがカタログ検索で発見可能になる
- 実データのコピーではなく、**メタデータの管理単位**

SageMaker Unified Studio（DataZone V2）では、Glue Data Catalog のテーブルに対してビジネスメタデータ（グロサリー用語、メタデータフォーム、説明等）を付与してカタログとして運用したり、サブスクリプション（アクセス申請→承認）でプロジェクト間でデータアクセスを管理するには、テーブルを「アセット」としてカタログに登録する必要があります。

また、[SageMaker Data Agent](https://docs.aws.amazon.com/ja_jp/sagemaker-unified-studio/latest/userguide/sagemaker-data-agent.html) ではアセットに付与されたビジネスメタデータを参照して、自然言語でのデータ発見やコード生成を行うことが出来ます。Data Agent を活用した **AI Ready なデータ基盤**を構築する上でも、アセット登録とビジネスメタデータの整備は重要です。

本記事では、AWS CLI を使って **Glue テーブルに対するデータソースを作成し、データソースランを実行してアセットを生成する**までの手順を解説します。

## 前提条件

- SageMaker Unified Studio ドメイン（IdC ベース / V2）が作成済み
- 対象プロジェクトが存在し、Glue 接続（connection）が設定済み
- 対象の Glue テーブルが Glue Data Catalog に存在

## 事前確認: プロジェクトの Glue 接続 ID を取得

データソース作成時に `--connection-identifier` で指定する Glue 接続 ID を確認します。接続はプロジェクト作成時に自動生成されます。

```bash
aws datazone list-connections \
  --domain-identifier <ドメインID> \
  --project-identifier <プロジェクトID> \
  --region ap-northeast-1
```

`"type": "GLUE"` の `connectionId` を控えておきます。

## 必要な Lake Formation 権限

プロジェクトの IAM ロール（`datazone_usr_role_<プロジェクトID>_<サフィックス>`）に対して、以下の Lake Formation 権限が必要です。

### 最小権限（データソース作成 + クエリ実行）

| レベル | 必要な権限 |
|--------|-----------|
| データベース | `DESCRIBE` |
| テーブル | `DESCRIBE`, `SELECT` |

### フル権限（+ サブスクリプションで他プロジェクトへ共有する場合）

| レベル | 必要な権限 |
|--------|-----------|
| データベース | `DESCRIBE`, `DESCRIBE_GRANTABLE` |
| テーブル | `DESCRIBE`, `SELECT`, `DESCRIBE_GRANTABLE`, `SELECT_GRANTABLE` |

### 権限付与コマンド

**データベースレベル:**
```bash
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<AWSアカウントID>:role/datazone_usr_role_<プロジェクトID>_<サフィックス>"}' \
  --resource '{"Database": {"CatalogId": "<AWSアカウントID>", "Name": "<Glueデータベース名>"}}' \
  --permissions '["DESCRIBE"]' \
  --permissions-with-grant-option '["DESCRIBE"]' \
  --region ap-northeast-1
```

**テーブルレベル:**
```bash
aws lakeformation grant-permissions \
  --principal '{"DataLakePrincipalIdentifier": "arn:aws:iam::<AWSアカウントID>:role/datazone_usr_role_<プロジェクトID>_<サフィックス>"}' \
  --resource '{"Table": {"CatalogId": "<AWSアカウントID>", "DatabaseName": "<Glueデータベース名>", "Name": "<テーブル名>"}}' \
  --permissions '["DESCRIBE", "SELECT"]' \
  --permissions-with-grant-option '["DESCRIBE", "SELECT"]' \
  --region ap-northeast-1
```

:::message
プロジェクトの IAM ロール名は `get-data-source` の結果に含まれる `dataAccessRole` で確認できます。
:::

## 全体フロー

```
1. create-data-source   → データソース定義を作成
2. get-data-source      → ステータスが READY になったことを確認
3. start-data-source-run → Glue テーブルのメタデータをスキャン
4. get-data-source-run  → ステータスが SUCCESS になったことを確認
5. search (ASSET)       → アセットが作成されたことを確認
```

## 手順

### Step 1: データソースの作成

```bash
aws datazone create-data-source \
  --domain-identifier <ドメインID> \
  --project-identifier <プロジェクトID> \
  --name "<データソース名>" \
  --type GLUE \
  --connection-identifier <接続ID> \
  --configuration '{
    "glueRunConfiguration": {
      "catalogName": "<AWSアカウントID>",
      "autoImportDataQualityResult": true,
      "relationalFilterConfigurations": [{
        "databaseName": "<Glueデータベース名>",
        "filterExpressions": [{
          "type": "INCLUDE",
          "expression": "<テーブル名>"
        }]
      }]
    }
  }' \
  --recommendation '{"enableBusinessNameGeneration": false}' \
  --enable-setting ENABLED \
  --no-publish-on-import \
  --region ap-northeast-1
```

**出力例:**
```json
{
    "id": "dtp3ka0l89zz15",
    "status": "CREATING"
}
```

#### 主要パラメータの説明

| パラメータ | 説明 |
|-----------|------|
| `--domain-identifier` | DataZone ドメイン ID（`dzd-xxxxx`） |
| `--project-identifier` | アセットを所属させるプロジェクト ID |
| `--connection-identifier` | Glue 接続の ID（プロジェクト作成時に自動生成される） |
| `catalogName` | **AWS アカウント ID** |
| `databaseName` | Glue データベース名 |
| `filterExpressions` | 取り込むテーブルのフィルタ（`*` で全テーブル） |
| `--no-publish-on-import` | アセット作成時にカタログへ自動パブリッシュしない |
| `enableBusinessNameGeneration` | AI によるビジネス名自動生成の有無 |

今回は検証のためにオンデマンドで start-data-source-run を実行しますが、--schedule を設定することで、定期的に実行してスキーマの更新等も可能です。

### Step 2: データソースのステータス確認

```bash
aws datazone get-data-source \
  --domain-identifier <ドメインID> \
  --identifier <Step1で取得したデータソースID> \
  --region ap-northeast-1
```

**成功時の出力（抜粋）:**
```json
{
    "id": "dtp3ka0l89zz15",
    "status": "READY",
    "type": "GLUE",
    "name": "<データソース名>",
    "configuration": {
        "glueRunConfiguration": {
            "catalogName": "<AWSアカウントID>",
            "relationalFilterConfigurations": [{
                "databaseName": "<Glueデータベース名>",
                "filterExpressions": [{"type": "INCLUDE", "expression": "<テーブル名>"}]
            }],
            "autoImportDataQualityResult": true
        }
    },
    "publishOnImport": false,
    "lastRunAssetCount": 0
}
```

`"status": "READY"` になっていれば成功です。

### Step 3: データソースランの実行

```bash
aws datazone start-data-source-run \
  --domain-identifier <ドメインID> \
  --data-source-identifier <データソースID> \
  --region ap-northeast-1
```

**出力例:**
```json
{
    "id": "5173nxdn633hnd",
    "status": "REQUESTED"
}
```

### Step 4: データソースランの結果確認

```bash
aws datazone get-data-source-run \
  --domain-identifier <ドメインID> \
  --identifier <Step3で取得したランID> \
  --region ap-northeast-1
```

**成功時の出力（抜粋）:**
```json
{
    "id": "5173nxdn633hnd",
    "status": "SUCCESS",
    "runStatisticsForAssets": {
        "added": 1,
        "updated": 0,
        "unchanged": 0,
        "failed": 0
    },
    "lineageSummary": {
        "importStatus": "SUCCESS"
    }
}
```

`"status": "SUCCESS"` かつ `"added": 1` であればアセット作成完了です。

### Step 5: 作成されたアセットの確認

```bash
aws datazone search \
  --domain-identifier <ドメインID> \
  --owning-project-identifier <プロジェクトID> \
  --search-scope ASSET \
  --search-text "<テーブル名>" \
  --region ap-northeast-1
```

**出力例:**
```json
{
    "items": [
        {
            "assetItem": {
                "identifier": "6b8qjy97lm9qxl",
                "name": "<テーブル名>",
                "typeIdentifier": "amazon.datazone.GlueTableAssetType",
                "externalIdentifier": "arn:aws:glue:ap-northeast-1:<AWSアカウントID>:table/<データベース名>/<テーブル名>.<プロジェクトID>",
                "createdBy": "SYSTEM",
                "owningProjectId": "<プロジェクトID>"
            }
        }
    ],
    "totalMatchCount": 1
}
```

## 次のステップ

アセット作成後は、以下のキュレーション作業を行うことでカタログとしての価値が高まります:

1. **ビジネス名・説明の追加** — `t_dy_zaiko` → 「日次確定在庫」のように、検索しやすい名前と説明を付与
2. **グロサリー用語の紐付け** — 組織共通の用語と関連付け
3. **メタデータフォームの添付** — 要件に応じてデータオーナー、更新頻度、個人情報区分等を構造化
4. **パブリッシュ** — ドメイン全体のユーザーが検索・発見可能に

## 参考

- [Create an Amazon SageMaker Unified Studio data source for AWS Glue in the project catalog](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-source-glue.html)
- [Configure Lake Formation permissions for Amazon SageMaker Unified Studio](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/lake-formation-permissions-for-amazon-sagemaker-unified-studio.html)
- [Asset revisions in Amazon DataZone](https://docs.aws.amazon.com/datazone/latest/userguide/asset-versioning.html)
