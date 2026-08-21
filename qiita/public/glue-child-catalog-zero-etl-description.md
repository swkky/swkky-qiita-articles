---
title: ゼロ ETL 統合で自動生成される Glue 子カタログの制約まとめ（説明付与・削除）
tags:
  - AWS
  - glue
  - SageMakerUnifiedStudio
  - ZeroETL
  - datacatalog
private: false
updated_at: '2026-08-21T09:16:06+09:00'
id: 371f056f6846175bcbf7
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

:::note alert
本記事の内容は **2026 年 8 月時点** の情報です。AWS のサービスは頻繁にアップデートされるため、最新の仕様は公式ドキュメントをご確認ください。
:::

## はじめに

SageMaker Unified Studio を社内データ基盤の統合プラットフォームとして利用する中で、ゼロ ETL 統合により自動生成される **Glue 子カタログ（`zetl_xxx`）** にはいくつかの制約があることがわかりました。

本記事では、2026 年 8 月時点で確認できた制約事項と代替案をまとめます。

## モチベーション

複数のデータソース（RDS）からゼロ ETL 統合を作成すると、ターゲットカタログ配下に `zetl_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` のような UUID ベースの子カタログが統合ごとに自動生成されます。

この名前だけでは **どの子カタログがどのデータソースに対応しているか全く判別できません。**

SageMaker Unified Studio をデータ基盤として社内の分析者に提供する場合、ユーザーはカタログを通じてデータを探索します。子カタログに「受注管理DB（Aurora MySQL / アカウントA）」のような説明が付与できればいいなと言うのが動機です。
説明を付与できないと、別途対応表のドキュメントを用意して共有する等の運用が必要になる可能性もあるかと思います。

## ゼロ ETL 統合のターゲット選択肢

RDS のゼロ ETL 統合では、ターゲットとして以下の 2 種類を選択できます。

| ターゲット | 概要 |
|-----------|------|
| **Glue データカタログ（Redshift 型カタログ）** | Glue カタログ経由で Redshift Serverless にデータが格納される。SageMaker Unified Studio との統合に適する |
| **Redshift（直接）** | Redshift Provisioned / Serverless を直接ターゲットに指定する。従来からある方式 |

**本記事は Glue データカタログ（Redshift 型カタログ）をターゲットにした場合の制約について記載しています。** Redshift を直接ターゲットにする構成ではこれらの制約は該当しません。

## 構成（本記事の対象）

```
[アカウント A（ソース）]
  └── RDS クラスター
        └── ゼロ ETL 統合

[アカウント B（ターゲット）]
  └── Redshift 型カタログ (my-lakehouse)
        └── 子カタログ (zetl_xxx) ← 自動生成
  └── Redshift Serverless
  └── SageMaker Unified Studio
```

別アカウントの RDS をデータソースとしてゼロ ETL 統合を作成するたびに、ターゲットカタログ配下に `zetl_xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 形式の子カタログが自動生成されます。

## 制約 1：子カタログの「説明」に任意の情報を付与できない

### 課題

例えば、SageMaker Unified Studio 上で子カタログを選択すると「説明」フィールドが存在しますが、**現時点ではここに任意の情報を設定する手段がありません。**

他の方法も模索しましたが、子カタログに直接情報を付与する方法は現状なさそうでした。

### 代替案 A：テーブルをカタログに公開（Publish）して説明を付与

子カタログ配下の**テーブル**をアセットとしてカタログに公開すると、テーブルごとに説明や README を記載できます。
ただし、テーブル単位になるので、テーブルを大量に持つ RDS クラスターとかだとアセットも大量に必要になります。

**手順：**

1. プロジェクトのデータタブから、子カタログ配下のテーブルを選択
2. アクションから「カタログに公開」を選択
3. 公開後、アセット詳細画面から説明・ビジネス名・README 等を編集

**メリット：**

- 説明欄に「アカウント A の Aurora MySQL (orders_db) 由来」等の情報を記載可能
- 記載した説明はカタログのキーワード検索の対象になるため、データソース名からの逆引きも可能

参考: [Curate and enrich asset metadata - Amazon SageMaker Unified Studio](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/catalog-iam-curate-metadata.html)

### 代替案 B：Amazon Bedrock チャットエージェントアプリ + ナレッジベース

一般的にデータカタログの管理、活用方法として Bedrock のナレッジベースを使用する方法が考えられます。
SageMaker Unified Studio のプロジェクト内で Amazon Bedrock ナレッジベースを作成し、子カタログとデータソースの対応関係をまとめたドキュメントを登録した上で、チャットエージェントアプリを構築する方法です。

これにより「`zetl_xxx` のデータソースは？」等のプロンプトで対応情報を取得できます。

参考:
- [Create an Amazon Bedrock Knowledge Base component](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/creating-a-knowledge-base-component.html)
- [Add an Amazon Bedrock Knowledge Base component to a chat agent app](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/add-kb-component-chat-app.html)

### ⚠️ Amazon Q Developer では対応不可

SageMaker Unified Studio 上の Amazon Q Developer には、任意のドキュメントをナレッジとして登録し参照させる機能はないため、Amazon Q を使って子カタログとデータソースの対応情報を回答させることはできないようです。

## 制約 2：子カタログをユーザー側から削除できない

### 課題

ゼロ ETL 統合を削除しても、自動生成された子カタログは残り続けます。そして **2026 年 8 月時点では、ユーザー側から子カタログを削除する手段がありません。**

削除するには AWS サポートへの依頼が必要でした。

:::note
なお、**カタログ単位（親カタログ）の削除は可能**です。
:::

### 推奨：検証用と本番用でカタログを分ける

子カタログが削除できない以上、検証で作成した不要な子カタログが本番カタログに残り続けるリスクがあります。

**検証用と本番用でターゲットカタログを分けて運用することを強く推奨します。**

```
[本番用]
  └── カタログ: my-lakehouse-prod
        └── zetl_xxx (本番データソースのみ)

[検証用]
  └── カタログ: my-lakehouse-dev
        └── zetl_xxx (検証で自由に作成・カタログごと削除可能)
```

## まとめ

| 制約 | 詳細 | 回避策 |
|------|------|--------|
| 子カタログに説明を付与できない | 「説明」フィールドへの書き込み手段なし | テーブルを Publish して説明付与 / Bedrock ナレッジベース |
| 子カタログを削除できない | ユーザー側からの削除手段なし（AWS サポート依頼が必要） | 検証用・本番用でカタログを分離 |
| Amazon Q Developer でのナレッジ登録 | 任意ドキュメントの登録不可 | Bedrock ナレッジベースを使用 |

:::note
いずれの制約も今後のアップデートで解消される可能性があります。最新情報は公式ドキュメントをご確認ください。
:::

## 参考リンク

- [Amazon RDS ゼロ ETL 統合](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/UserGuide/zero-etl.html)
- [Curate and enrich asset metadata - Amazon SageMaker Unified Studio](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/catalog-iam-curate-metadata.html)
