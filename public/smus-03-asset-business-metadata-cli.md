---
title: SageMaker Unified Studio アセットにビジネスメタデータをAWS CLIから付与する
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - datacatalog
  - awscli
private: false
updated_at: '2026-08-31T16:57:26+09:00'
id: d84b98fceff972c14fa4
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

:::note info
本記事は以下のシリーズ記事の続編です。アセットやビジネスコンテキストの概要についてはそれぞれこちらを参照ください。
- [SageMaker Unified Studio 「アセットってなに？」](https://qiita.com/swkky/items/092df5056ee13b7a9297)<!--ref:asset-from-glue--><!--/ref-->
- [Data Agent 活用の観点で SageMaker Unified Studio のアセットに付与すべきビジネスコンテキストと優先度](https://qiita.com/swkky/items/9bbb5a7251b3a8adf063)<!--ref:asset-business-context--><!--/ref-->
:::

SageMaker Unified Studio（DataZone V2）のアセットには、Business Name・Description・README・グロサリー用語・メタデータフォームといったビジネスコンテキストを UI から付与できます。

しかし、アセットが数百〜数千ある環境では手作業での付与は現実的ではないため、本記事ではAWS CLI（`aws datazone`）を使って**アセットレベル・カラムレベルのビジネスコンテキストを付与する方法**を解説します。

:::note
SageMaker Unified StudioのカタログはDataZone V2で構築されており、CLIは `aws datazone` を使用します。
:::

## 対応表: ビジネスコンテキストとCLIコマンド

#9〜#10 のカラムに対する README、メタデータフォームのみ batch-put-attributes-metadata での付与になります。  
それ以外は create-asset-revision で付与可能です。

| # | ビジネスコンテキスト | レベル | 使用API |
|---|---------------------|--------|---------|
| 1 | Business Name | アセット | `create-asset-revision` (`--name`) |
| 2 | Description | アセット | `create-asset-revision` (`--description`) |
| 3 | README | アセット | `create-asset-revision` (`--forms-input` の `AssetCommonDetailsForm.readMe`) |
| 4 | グロサリー用語 | アセット | `create-asset-revision` (`--glossary-terms`) |
| 5 | メタデータフォーム | アセット | `create-asset-revision` (`--forms-input` のカスタムフォーム) |
| 6 | Business Name | カラム | `create-asset-revision` (`--forms-input` の `ColumnBusinessMetadataForm.name`) |
| 7 | Description | カラム | `create-asset-revision` (`--forms-input` の `ColumnBusinessMetadataForm.description`) |
| 8 | グロサリー用語 | カラム | `create-asset-revision` (`--forms-input` の `ColumnBusinessMetadataForm.glossaryTerms`) |
| 9 | README | カラム | `batch-put-attributes-metadata` (`AttributeCommonFormType.readMe`) |
| 10 | メタデータフォーム | カラム | `batch-put-attributes-metadata` (`forms` リストにカスタムフォーム追加) |

## 前提条件

- アセットが既に作成済みであること（[Glue テーブルに対するアセット作成手順](https://qiita.com/swkky/items/092df5056ee13b7a9297)を参照）
- カスタムメタデータフォーム（使用する場合）がドメインに定義済みであること

本記事では以下のサンプルアセットを使用します:

| 項目 | 値 |
|------|-----|
| ドメイン | `dzd-xxxxxxxxxxxxx` |
| アセットID | `xxxxxxxxxxxx` |
| テクニカル名 | `orders_table` |
| アセットタイプ | `amazon.datazone.GlueTableAssetType` |

## 1. アセットレベルのビジネスコンテキスト付与

### 使用コマンド: `create-asset-revision`

1回のコマンドで以下を一括設定できます:
- Business Name（`--name`）
- Description（`--description`）
- グロサリー用語（`--glossary-terms`）
- README（`--forms-input` の `AssetCommonDetailsForm.readMe`）
- メタデータフォーム（`--forms-input` のカスタムフォーム）
- カラムの Business Name / Description / Glossary Terms（`--forms-input` の `ColumnBusinessMetadataForm`）

### 注意点1: 既存のフォームを全て含める

`--forms-input` を指定する場合、ビジネスメタデータ系フォームだけでなく**既存のフォームも全て含める**必要があります。

| フォーム | 欠落時の影響 |
|---------|-------------|
| `GlueTableForm` | `ValidationException` でコマンド自体が失敗 |
| `DataSourceReferenceForm` | アセットが **Unmanaged** 状態になりサブスクリプション不可 |
| `SubscriptionTermsForm` | サブスクリプション設定が消失 |

これらはデータソースランやパブリッシュ時に自動設定されるフォームです:

- **`GlueTableForm`**: Glueテーブルの技術情報（カタログID、データベース名、カラム定義、データ型、S3ロケーション等）。UIのSCHEMAタブのカラム一覧はここから表示される
- **`DataSourceReferenceForm`**: アセットとデータソースの紐づけ情報（データソースID、ランID等）
- **`SubscriptionTermsForm`**: サブスクリプション時の承認要否設定

:::note warn
`--forms-input` は「指定したフォームで上書き」する動作です。既存フォームを省略するとそのフォームが削除されます。   `get-asset` で現在のフォームを全て取得し、変更したいフォームだけ内容を書き換えて全フォームを含める必要があります。
:::

#### 既存の GlueTableForm の取得方法

```bash
# get-asset で現在のアセット情報を取得し、GlueTableForm の content を抽出
aws datazone get-asset \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --query "formsOutput[?formName=='GlueTableForm'].content | [0]" \
  --output text \
  --region ap-northeast-1
```

<!-- #### jq を使ったワンライナー自動化

```bash
# ステップ1: GlueTableForm の content を変数に格納
GLUE_FORM_CONTENT=$(aws datazone get-asset \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --query "formsOutput[?formName=='GlueTableForm'].content | [0]" \
  --output text \
  --region ap-northeast-1)

# ステップ2: jq で forms-input JSON を組み立てて create-asset-revision を実行
aws datazone create-asset-revision \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --name "注文履歴" \
  --forms-input "$(jq -n --arg glue "$GLUE_FORM_CONTENT" '[
    {
      "formName": "GlueTableForm",
      "typeIdentifier": "amazon.datazone.GlueTableFormType",
      "typeRevision": "13",
      "content": $glue
    },
    {
      "formName": "ColumnBusinessMetadataForm",
      "typeIdentifier": "amazon.datazone.ColumnBusinessMetadataFormType",
      "typeRevision": "8",
      "content": "{\"columnsBusinessMetadata\":[{\"columnIdentifier\":\"order_id\",\"name\":\"注文ID\",\"description\":\"注文を一意に識別するID\"}]}"
    }
  ]')" \
  --type-revision "24" \
  --region ap-northeast-1
``` -->

### 注意点2: typeRevision の指定について

`--forms-input` の各フォームには `typeRevision` を指定する必要があります。これはフォーム定義のバージョン番号であり、**フォーム定義が更新されるたびにインクリメント**されます。

| フォーム | typeRevision の特徴 |
|---------|-------------------|
| `GlueTableForm` 等のシステムフォーム | DataZone 側のアップデートで自動的に上がる |
| カスタムメタデータフォーム | フォーム定義を変更した際に上がる |

間違ったリビジョンを指定すると `ValidationException`（スキーマ不一致）が発生します。例えば、フォーム定義の Revision 1 と 2 でフィールド名が変わっている場合、古いリビジョンのフィールド名で送信するとエラーになります。

**最新リビジョンの取得方法:**

```bash
# システムフォーム（GlueTableForm等）: get-asset の formsOutput から確認
aws datazone get-asset \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --query "formsOutput[].{formName:formName,typeName:typeName,typeRevision:typeRevision}" \
  --output table \
  --region ap-northeast-1

# カスタムフォーム: get-form-type で最新リビジョンを直接取得
aws datazone get-form-type \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --form-type-identifier MyCustomMetadataForm \
  --query "revision" \
  --output text \
  --region ap-northeast-1
```

:::note
メタデータが付与されていない状態での実行はいいのですが、既存のメタデータが付与されている 2 回目以降、このあたりを考慮して実行するのは面倒なので、スクリプトを組んで、`get-asset`で既存フォーム、`get-form-type` で最新リビジョンを動的に取得して付与した方が楽そうです。
:::

### 実行コマンド例

```bash
aws datazone create-asset-revision \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --name "注文履歴" \
  --description "ECサイトにおける注文トランザクションデータ。注文ID・顧客ID・注文日時・商品・金額を記録。売上分析・顧客行動分析に使用。" \
  --glossary-terms "gt-term-id-001" "gt-term-id-002" \
  --forms-input '[
    {
      "formName": "GlueTableForm",
      "typeIdentifier": "amazon.datazone.GlueTableFormType",
      "typeRevision": "13",
      "content": "<get-assetで取得したGlueTableFormのcontent>"
    },
    {
      "formName": "AssetCommonDetailsForm",
      "typeIdentifier": "amazon.datazone.AssetCommonDetailsFormType",
      "typeRevision": "8",
      "content": "{\"sourceIdentifier\":\"arn:aws:glue:ap-northeast-1:123456789012:table/my_database/orders_table\",\"readMe\":\"# 注文履歴テーブル\\n\\n## 概要\\nECサイトの注文トランザクション。\\n\\n## テーブル構造\\n- **order_id** (PK): 注文ID\\n- **customer_id**: 顧客ID\\n- **order_details**: 注文詳細（struct型）\"}"
    },
    {
      "formName": "MyCustomMetadataForm",
      "typeIdentifier": "MyCustomMetadataForm",
      "typeRevision": "1",
      "content": "{\"dataOwner\":\"データ分析部\",\"updateFrequency\":\"日次バッチ\",\"personalInfoClass\":\"レベル2\"}"
    },
    {
      "formName": "ColumnBusinessMetadataForm",
      "typeIdentifier": "amazon.datazone.ColumnBusinessMetadataFormType",
      "typeRevision": "8",
      "content": "{\"columnsBusinessMetadata\":[{\"columnIdentifier\":\"order_id\",\"name\":\"注文ID\",\"description\":\"注文を一意に識別するID。UUIDv4形式。\",\"glossaryTerms\":[\"gt-term-id-001\"]},{\"columnIdentifier\":\"customer_id\",\"name\":\"顧客ID\",\"description\":\"顧客を一意に識別するID。\",\"glossaryTerms\":[\"gt-term-id-002\"]},{\"columnIdentifier\":\"order_details\",\"name\":\"注文詳細\",\"description\":\"注文の明細情報を格納するstruct型カラム。\",\"glossaryTerms\":[\"gt-term-id-001\",\"gt-term-id-002\"]}]}"
    }
  ]' \
  --type-revision "24" \
  --region ap-northeast-1
```

### 実行結果

```json
{
    "id": "xxxxxxxxxxxx",
    "name": "注文履歴",
    "typeIdentifier": "amazon.datazone.GlueTableAssetType",
    "revision": "2",
    "description": "ECサイトにおける注文トランザクションデータ...",
    "glossaryTerms": ["gt-term-id-001", "gt-term-id-002"],
    "formsOutput": [
        {"formName": "GlueTableForm", "...": "..."},
        {"formName": "AssetCommonDetailsForm", "...": "... readMe あり ..."},
        {"formName": "MyCustomMetadataForm", "...": "... カスタムフォーム ..."},
        {"formName": "ColumnBusinessMetadataForm", "...": "... カラムメタデータ ..."}
    ]
}
```

## 2. カラムレベルのREADME / メタデータフォーム付与

### 使用コマンド: `batch-put-attributes-metadata`

カラムの README とカスタムメタデータフォームを設定します。

:::note alert
検証した結果、カラムレベルのREADME、メタデータフォームのみ batch-put-attributes-metadata でないと付与出来なさそうでした
:::

### 実行コマンド例

```bash
aws datazone batch-put-attributes-metadata \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --entity-type ASSET \
  --entity-identifier xxxxxxxxxxxx \
  --attributes '[
    {
      "attributeIdentifier": "order_id",
      "forms": [
        {
          "formName": "AttributeCommonFormType",
          "typeIdentifier": "AttributeCommonFormType",
          "typeRevision": "2",
          "content": "{\"readMe\":\"# order_id\\n\\n## 概要\\n注文を一意に識別するID。UUIDv4形式。\\n\\n## 結合先\\n- order_items_table.order_id\\n- shipments_table.order_id\"}"
        },
        {
          "formName": "MyCustomMetadataForm",
          "typeIdentifier": "MyCustomMetadataForm",
          "typeRevision": "1",
          "content": "{\"dataOwner\":\"データ分析部\",\"updateFrequency\":\"日次バッチ\",\"personalInfoClass\":\"なし\"}"
        }
      ]
    },
    {
      "attributeIdentifier": "customer_id",
      "forms": [
        {
          "formName": "AttributeCommonFormType",
          "typeIdentifier": "AttributeCommonFormType",
          "typeRevision": "2",
          "content": "{\"readMe\":\"# customer_id\\n\\n## 概要\\n顧客を一意に識別するID。\\n\\n## 結合先\\n- customers_table.customer_id\"}"
        },
        {
          "formName": "MyCustomMetadataForm",
          "typeIdentifier": "MyCustomMetadataForm",
          "typeRevision": "1",
          "content": "{\"dataOwner\":\"データ分析部\",\"updateFrequency\":\"日次バッチ\",\"personalInfoClass\":\"レベル2\"}"
        }
      ]
    },
    {
      "attributeIdentifier": "order_details",
      "forms": [
        {
          "formName": "AttributeCommonFormType",
          "typeIdentifier": "AttributeCommonFormType",
          "typeRevision": "2",
          "content": "{\"readMe\":\"# order_details\\n\\n## 概要\\n注文の明細情報を格納するstruct型カラム。\\n\\n## 主要子フィールド\\n| フィールド | 説明 |\\n|---|---|\\n| product_name | 商品名 |\\n| quantity | 数量 |\\n| unit_price | 単価 |\\n| total_amount | 合計金額 |\"}"
        },
        {
          "formName": "MyCustomMetadataForm",
          "typeIdentifier": "MyCustomMetadataForm",
          "typeRevision": "1",
          "content": "{\"dataOwner\":\"データ分析部\",\"updateFrequency\":\"日次バッチ\",\"personalInfoClass\":\"なし\"}"
        }
      ]
    }
  ]' \
  --region ap-northeast-1
```

### 実行結果

```json
{
    "attributes": [
        { "attributeIdentifier": "order_id" },
        { "attributeIdentifier": "customer_id" },
        { "attributeIdentifier": "order_details" }
    ]
}
```

### UIに反映されるフォームタイプの特定方法

本記事で紹介したフォームタイプ（`AttributeCommonFormType` 等）は、**UIから各項目を設定した後に `batch-get-attributes-metadata` で保存先を確認する**という方法で特定しました。

## 3. 確認コマンド

### アセットレベル確認: `get-asset`

```bash
aws datazone get-asset \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --identifier xxxxxxxxxxxx \
  --region ap-northeast-1
```

### カラムレベル確認: `batch-get-attributes-metadata`

```bash
aws datazone batch-get-attributes-metadata \
  --domain-identifier dzd-xxxxxxxxxxxxx \
  --entity-type ASSET \
  --entity-identifier xxxxxxxxxxxx \
  --attribute-identifiers "order_id" "customer_id" "order_details" \
  --region ap-northeast-1
```

Unified Studio の UI からも付与されている情報を確認出来ました。

### まとめ

| UIの表示項目 | 保存先API | フォーム | CLI設定方法 |
|-------------|----------|---------|------------|
| Business Name | アセットレベル (`get-asset` formsOutput) | `ColumnBusinessMetadataForm` の `.name` | `create-asset-revision --forms-input` |
| Business Description | アセットレベル (`get-asset` formsOutput) | `ColumnBusinessMetadataForm` の `.description` | `create-asset-revision --forms-input` |
| GLOSSARY TERMS | アセットレベル (`get-asset` formsOutput) | `ColumnBusinessMetadataForm` の `.glossaryTerms` | `create-asset-revision --forms-input` |
| README | カラム属性レベル (`batch-get-attributes-metadata`) | **`AttributeCommonFormType`** の `.readMe` | `batch-put-attributes-metadata` |
| METADATA FORMS | カラム属性レベル (`batch-get-attributes-metadata`) | カスタムフォーム | `batch-put-attributes-metadata` |
