---
title: Data Agent 活用の観点で SageMaker Unified Studio のアセットに付与すべきビジネスコンテキストと優先度
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - DataAgent
  - datacatalog
private: false
updated_at: '2026-09-14T09:48:58+09:00'
id: 9bbb5a7251b3a8adf063
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

SageMaker Unified Studio（DataZone V2）では、Glue テーブルを「アセット」としてカタログに登録し、ビジネスコンテキスト（メタデータ）を付与できます。

アセットについては[別の記事](https://qiita.com/swkky/items/092df5056ee13b7a9297)で解説しているので、そちらを参照してください。

本記事では、**アセットに付与可能なビジネスコンテキストの全体像**と、特に **Data Agent 活用の観点でどこから手をつけるべきか**を整理します。

:::note
優先度の判定は公式ドキュメントの記述を根拠にしていますが、各フィールドの相対的な重みは AWS から公開されていません。**優先順位は筆者の個人的な見解**です。
:::

## Data Agent はビジネスコンテキストをどう使うのか

まず、[SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html) とはアセットに付与されたビジネスメタデータを参照して、自然言語でデータセットを探索したり、SQL、Python などのコード生成を行うことが出来る Unified Studio の機能で、現時点では、Unified Studio 内のノートブック、クエリエディタから利用可能です。
2026年6月4日の GA で、Data Agent がビジネスカタログのメタデータを公式に参照するようになりました。

[公式ドキュメント](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)によると、Agent は以下の流れでテーブルを特定します。

1. Glue / Redshift の技術メタデータ（テーブル名・カラム名・型）で候補を検索
2. ビジネスカタログ（グロサリー・メタデータフォーム・Description・README）でビジネス用語にマッチするアセットを検索
3. 両方の結果をマージして最終的なテーブルを決定
4. 特定したテーブルのカラム情報を使って SQL / PySpark を生成

ビジネスコンテキストが「2段目のフィルター」として機能するようです。  
アセット、ビジネスメタデータを整備することで Data Agent を利用して以下のようなことが可能になります。

データの探索
プロンプト:「顧客離脱に関するデータはありますか？」
該当するデータを保有する可能性があるアセットを一覧で提示してくれる。
コード生成
プロンプト:「2026 年 Q3-Q4 における顧客維持率を計算してください。」
適切なテーブル(アセット)とカラムを使用して、SQL or PySpark コードを生成してくれる。

## アセットに付与可能なビジネスコンテキスト一覧

アセットレベル・カラムレベルそれぞれに設定できるフィールドは以下の通りです。

| レベル | フィールド | 概要 |
|--------|-----------|------|
| アセット | Business Name | テクニカル名とは別の表示名。検索結果に直接表示される |
| アセット | Description (summary) | アセットの説明文（自由記述） |
| アセット | README | Markdown 形式の詳細ドキュメント |
| アセット | グロサリー用語 | ビジネス用語との紐付け |
| アセット | メタデータフォーム | カスタム属性（キー・バリュー） |
| カラム | Business Name | カラムのテクニカル名とは別の表示名 |
| カラム | Description | カラムの説明文 |
| カラム | README | カラムレベルの Markdown ドキュメント |
| カラム | グロサリー用語 | カラムへのビジネス用語の紐付け |
| カラム | メタデータフォーム | カラムへのカスタム属性 |

Data Agent は上記すべてを参照対象としているはず。。。ですが、実際に検証すると、アセット、カラムの README やメタデータフォームの内容は考慮され無さそうでした。

> When your domain has a configured SageMaker Catalog with published assets, the Data Agent uses **glossary terms, custom metadata forms, summaries, and README content** to find the correct tables for your queries.
> — [Using Business Context with the SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)

## Data Agent 活用の観点での優先度

個人的に考えた優先度を以下にまとめます。

### 1位: カラムの Description

Agent によるデータ探索、およびSQL、スクリプト生成の両方で「どのテーブルに目当てデータがありそうか」、「どのカラムが該当しそうか」といった判断するための情報として重要そう。

公式ブログでもこのフィールドを SQL 生成のクオリティに影響する要素として記載している。

> Table descriptions and **column-level business metadata** improve the quality of generated SQL.
> — [Accelerate SQL development with SageMaker Data Agent in Query Editor](https://aws.amazon.com/blogs/big-data/accelerate-sql-development-with-sagemaker-data-agent-in-query-editor/)

全カラムを一度に整備するのは大変なので、よく使われるカラムや誤用されやすいカラムから優先的に拡充するのが良さそう。

**書くべき内容:**

(1) カラムの業務的な意味（日本語）
  - 例: このレコードが属するキャンペーンの一意識別子。campaign テーブルの campaign_id と対応する外部キー。

(2) 取りうる値と意味
  - 例: ステータスコード。1=有効、2=下書き、3=終了済み、9=削除済み。通常の分析では status = 1 のみを対象にすること。

(3) フィルタ条件の注意点
  - 例: 論理削除フラグ。is_deleted = 0 のレコードのみが有効。クエリには必ず is_deleted = 0 の条件を付けること。

(4) JOIN 先テーブルとキーの情報
  - 例: 外部キー。customer テーブルの customer_id と JOIN することで顧客属性を取得できる。

### 2位: アセットの Description (summary)

テーブルが「何のデータか」を簡潔に表す。検索時のスコアリングに影響しそう。

**書くべき内容:**

(1) テーブルの用途・業務上の意味

(2) 主要カラムの説明

(3) フィルタ条件や集計時の注意点（例：status = 'active' のみ有効なレコードを対象にする、など）

(4) クエリ方法 (クエリエンジン、FROM句など)

### 3位: Business Name（アセット＋カラム）

検索時、直接表示されるフィールド。テーブル名、カラム名から意味を汲み取るのが難しい場合（`tbl_prd_001` など）に、付与すると効果的。

- データソースからアセットを作成する際、[enableBusinessNameGeneration](https://qiita.com/swkky/items/092df5056ee13b7a9297#step-1-%E3%83%87%E3%83%BC%E3%82%BF%E3%82%BD%E3%83%BC%E3%82%B9%E3%81%AE%E4%BD%9C%E6%88%90) を有効にすると、自動で作成してくれる。
- アセット作成後でも、UI の「Generate suggestions」で AI 一括生成 → レビューも可能

**例:**

| テクニカル名 | ビジネス名 |
|-------------|-----------|
| `t_ord_hist_001` | 注文履歴 |
| `prod_cd` | 商品コード |

### 4位: グロサリー用語の紐付け (アセット+カラム)

ユーザーが「月次の売上データを見せて」と聞いた際に、グロサリー用語 "月次売上" がテーブルにマッチする橋渡しをします。

> You can ask the Data Agent questions using the **business terminology defined in your catalog**. The agent matches your terms against glossary terms...
> — [Using Business Context with the SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)

グロサリーの `long_description` にシノニム（同義語）、適用テーブル、主要カラムを含めておくと、Data Agent の探索精度が上がると思います。

## まとめ

| 優先度 | フィールド | ポイント |
|--------|-----------|---------|
| 1 | カラムの Description | データ探索、SQL 生成精度に直結しそうなので優先して着手すべき |
| 2 | アセットの Description | 検索スコアリングに影響。業務用語を含めて書く |
| 3 | Business Name（アセット＋カラム） | 整備コスト低（AI 生成可）。暗号的な名前には必須 |
| 4 | グロサリー用語 (アセット+カラム) | 自然言語→テーブル変換の中核。用語設計が必要 |

## 次の記事

次の記事では AWS CLI を使って実際にアセットにビジネスメタデータを付与する方法を解説しています。

👉 [SageMaker Unified Studio アセットにビジネスメタデータをAWS CLIから付与する](https://qiita.com/swkky/items/d84b98fceff972c14fa4)

## 参考

- [Using Business Context with the SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)
- [What's New - Amazon SageMaker Data Agent integrates business context (2026/6/4)](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-sagemaker-data-agent-bdc/)
- [Accelerate SQL development with SageMaker Data Agent in Query Editor](https://aws.amazon.com/blogs/big-data/accelerate-sql-development-with-sagemaker-data-agent-in-query-editor/)
- [Curate and enrich asset metadata](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/catalog-iam-curate-metadata.html)
