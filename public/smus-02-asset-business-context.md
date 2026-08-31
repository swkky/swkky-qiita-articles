---
title: Data Agent 活用の観点で SageMaker Unified Studio のアセットに付与すべきビジネスコンテキストと優先度
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - DataAgent
  - datacatalog
private: false
updated_at: '2026-08-31T10:43:31+09:00'
id: 9bbb5a7251b3a8adf063
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

SageMaker Unified Studio（DataZone V2）では、Glue テーブルを「アセット」としてカタログに登録し、ビジネスコンテキスト（メタデータ）を付与できます。

アセットの概要や作成手順については[前の記事](https://qiita.com/swkky/items/092df5056ee13b7a9297)で解説しているので、そちらを参照してください。

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

Data Agent は上記すべてを参照対象としているはず。。。

> When your domain has a configured SageMaker Catalog with published assets, the Data Agent uses **glossary terms, custom metadata forms, summaries, and README content** to find the correct tables for your queries.
> — [Using Business Context with the SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)

## Data Agent 活用の観点での優先度

個人的に考えた優先度を以下にまとめます。

### 1位: カラムの Description

Agent によるデータ探索、およびSQL、スクリプト生成の両方で「どのテーブルに目当てデータがありそうか」、「どのカラムが該当しそうか」といった判断するための情報として重要そう。

公式ブログでもこのフィールドを SQL 生成のクオリティに影響する要素として記載している。

> Table descriptions and **column-level business metadata** improve the quality of generated SQL.
> — [Accelerate SQL development with SageMaker Data Agent in Query Editor](https://aws.amazon.com/blogs/big-data/accelerate-sql-development-with-sagemaker-data-agent-in-query-editor/)

**書くべき内容:**

- 業務的な意味（日本語）
- 値の形式・範囲
- ネスト構造がある場合は子フィールドの一覧

**例:**

| カラム | Description |
|--------|-------------|
| `cust_id` | 顧客の一意識別子。orders テーブルとの結合キー。 |
| `order_detail` | 注文明細を格納する struct 型。主な子フィールド: order_date.S（注文日 YYYYMMDD）、product_name.S（商品名）、quantity.N（数量）、amount.N（金額）。Athena では order_detail.order_date.S のようにドット記法でアクセス。 |

### 2位: アセットの Description (summary)

テーブルが「何のデータか」を簡潔に表す。検索時のスコアリングに影響しそう。

**書くべき内容:**

- 業務用語を含める（Agent のマッチング対象になる）
- 一文目でテーブルの概要を伝える
  - 具体的にどのようなデータを扱うテーブルなのか
- ソースシステム名や用途も書いておく

**例:**

```
EC サイトの注文トランザクションテーブル。
顧客ID・注文日時・商品・数量・金額を記録。売上分析・在庫管理に使用。
```

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

グロサリーの `long_description` にシノニム（同義語）、適用テーブル、主要カラムを含めておくと、Agent の探索精度が上がると思います。

### 5位: アセットの README

Markdown 形式で詳細なドキュメントを書ける場所。

ただし長文の自由記述なので、Agent がマッチングに使えるキーワードが文章中に埋もれやすく、description やグロサリーほどピンポイントには効きにくい印象。整備コストも高い。以下のような「技術的に有用だが description に収まりきらない情報」を書くのに向いていそう。

- クエリ例・テーブル結合パターン
- ネスト構造のアクセス方法
- 関連テーブルとの結合キー情報

### 6位: アセットのメタデータフォーム

主にガバナンス用途（PII 分類、データオーナー、SLA 等）に使われるフィールドという認識ですが、Data Agent の検索対象にも含まれます。

フォームの**フィールド値**がリアルタイムにインデックスされるため、ビジネスドメイン名（"Sales", "Marketing", "Logistics" 等）を値に含めておくと Agent のマッチングに寄与しそう。  
ただし、description やグロサリーで同じ情報をカバーできる場合が多く、整備コスト（フォーム設計＋値入力）も高そうなので、Data Agent の活用という観点だと優先度は低いと判断しました。

## まとめ

| 優先度 | フィールド | ポイント |
|--------|-----------|---------|
| 1 | カラムの Description | データ探索、SQL 生成精度に直結しそうなので優先して着手すべき |
| 2 | アセットの Description | 検索スコアリングに影響。業務用語を含めて書く |
| 3 | Business Name（アセット＋カラム） | 整備コスト低（AI 生成可）。暗号的な名前には必須 |
| 4 | グロサリー用語 (アセット+カラム) | 自然言語→テーブル変換の中核。用語設計が必要 |
| 5 | アセットの README | 詳細ドキュメント。コスト高だが Agent も参照する |
| 6 | アセットのメタデータフォーム | ガバナンス兼用。優先度は低いが参照はされる |

## 次の記事

次の記事では AWS CLI を使って実際にアセットにビジネスメタデータを付与する方法を解説しています。

👉 [SageMaker Unified Studio アセットにビジネスメタデータをAWS CLIから付与する](https://qiita.com/swkky/items/d84b98fceff972c14fa4)

## 参考

- [Using Business Context with the SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html)
- [What's New - Amazon SageMaker Data Agent integrates business context (2026/6/4)](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-sagemaker-data-agent-bdc/)
- [Accelerate SQL development with SageMaker Data Agent in Query Editor](https://aws.amazon.com/blogs/big-data/accelerate-sql-development-with-sagemaker-data-agent-in-query-editor/)
- [Curate and enrich asset metadata](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/catalog-iam-curate-metadata.html)
