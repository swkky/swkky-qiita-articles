---
title: RDS ゼロ ETL のターゲット選択：Glue フェデレーテッドカタログでは REFRESH_INTERVAL と RPU を調整できない
tags:
  - AWS
  - RDS
  - Redshift
  - glue
  - ZeroETL
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

:::note alert
本記事の内容は **2026 年 9 月時点** の情報です。
:::

## はじめに

現状、RDS（Aurora を含む）をデータソースとするゼロ ETL 統合では、ターゲットは以下の 2 つから選択することになります。  
残念ながら、S3 は指定出来ません。。。DynamoDB がデータソースの場合は S3 を指定可能です。(Iceberg or S3Tables)

| # | ターゲット | 概要 |
|---|-----------|------|
| A | **Glue Redshift マネージドカタログ** | Glue のフェデレーテッドカタログ（Redshift 型カタログ）経由でデータを取り込む。SageMaker Unified Studio との統合に適する |
| B | **Amazon Redshift（Serverless / Provisioned）直接** | Redshift データウェアハウスを直接ターゲットに指定する。 |

どちらも「ソースの RDS に書き込んだデータをニアリアルタイムでターゲットに複製できる」という点は共通です。  
しかし、パターン A（Glue フェデレーテッドカタログ）の場合、以下の 2 点の大きな制約があります。

- **`REFRESH_INTERVAL`（複製間隔）を指定・調整できない**
- **RPU（Redshift Serverless のキャパシティ）を指定・調整できない**

---

## パターン A （Glue Redshift マネージドカタログ）のデメリット（コスト観点）

パターン A では、データの実体は AWS Glue Data Catalog（Redshift マネージドカタログ）に対して自動的に作成されるマネージドワークグループに格納され、このワークグループは **AWS 側で管理される**ため、ユーザーがコスト最適化のためのパラメータを触れません。具体的には次の 2 点です。

### デメリット 1：`REFRESH_INTERVAL`（複製間隔）を指定・調整できない

Redshift のゼロ ETL では、CDC (Change Data Capture) の頻度を `REFRESH_INTERVAL` で制御できます。これはコストに直結するパラメータです。

- 間隔を**短く**すると CDC のリアルタイム性は上がるが、複製処理のためのコンピュートコストが上がる
- 間隔を**長く**（例：5 分以上）すると、即時性が不要なワークロード（レポーティングや履歴分析など）ではコンピュート課金を抑えられる

公式ドキュメントでも、ゼロ ETL のコスト最適化手段として `REFRESH_INTERVAL` の調整が挙げられています。

> Configure the REFRESH_INTERVAL of your target Redshift instance to balance freshness with cost. Shorter intervals ensure near real-time updates but drive up compute costs. Longer intervals (5 minutes or longer) reduce charges ...

出典: [Billing for Amazon Redshift Serverless — Cost optimization for Amazon Redshift Serverless with zero-ETL](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-billing.html)

**パターン A では、この `REFRESH_INTERVAL` をユーザー側で指定・調整する手段がありません。**   
そのため、リアルタイム性が不要なワークロードであっても CDC の間隔を伸ばしてコストを下げる、といったチューニングができません。

### デメリット 2： Redshift の RPU（基本キャパシティ） を指定・調整できない

Redshift Serverless の課金は RPU（Redshift Processing Unit）ベースです。base RPU capacity を下げること（例：8 RPU）も、ゼロ ETL のコスト最適化手段として明記されています。

> Use the lower base RPU capacity of 8 RPU where available for workloads.

出典: [Billing for Amazon Redshift Serverless — Cost optimization for Amazon Redshift Serverless with zero-ETL](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-billing.html)

**パターン A では、ターゲットの Redshift Serverless がマネージドで、base RPU や max RPU をユーザー側で指定・調整できません。** 

---

## パターン B （Redshift Serverless 直接） ならコストを最適化できる

上記 2 点の裏返しですが、Redshift Serverless を直接、ゼロ ETL のターゲットにすると、両方を制御可能です。

- **`REFRESH_INTERVAL` を調整**して、リアルタイム性の要件とコストのバランスを取れる（`ALTER DATABASE` で変更可能）
- **base RPU capacity を調整**して、ワークロードに見合ったキャパシティに右サイズできる

出典: [Cost optimization for Amazon Redshift Serverless with zero-ETL](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-billing.html)

---

## 比較まとめ（コスト観点）

| コスト最適化のレバー | A：Glue フェデレーテッドカタログ | B：Redshift Serverless 直接 |
|--------------------|-------------------------------|---------------------------|
| `REFRESH_INTERVAL`（複製間隔） | **指定・調整不可** | 調整可能（`ALTER DATABASE`） |
| RPU（Redshift キャパシティ） | **指定・調整不可** | 調整可能（[UpdateWorkgroup](https://docs.aws.amazon.com/ja_jp/redshift-serverless/latest/APIReference/API_UpdateWorkgroup.html) など） |

## SageMaker Lakehouse/Unified Studio との統合
[公式ドキュメント](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/UserGuide/zero-etl.setting-up.html)だと、SageMaker Lakehouse/Unified Studio に対してゼロ ETL 統合を作成する場合には、パターン A の Glue Redshift マネージドカタログをターゲットにする方法が記載されています。  
しかし、[AWS ブログ](https://aws.amazon.com/jp/blogs/big-data/reduce-time-to-access-your-transactional-data-for-analytical-processing-using-the-power-of-amazon-sagemaker-lakehouse-and-zero-etl/)によると、パターン B の場合でも、Redshift Serverless の名前空間を Glue カタログに登録してフェデレーテッドカタログを作成することで、SageMaker Lakehouse/Unified Studio から参照は可能という情報がありました。

## まとめ
リアルタイムな連携が必要、運用負荷を抑えたい場合->パターン A （Glue Redshift マネージドカタログ）  
リアルタイムな連携が不要、コストを抑えたい ->パターン B (Redshift Serverless 直接)


## 参考リンク

- [Amazon RDS ゼロ ETL 統合](https://docs.aws.amazon.com/ja_jp/AmazonRDS/latest/UserGuide/zero-etl.html)
- [Billing for Amazon Redshift Serverless（ゼロ ETL のコスト最適化）](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-billing.html)
- [Creating Amazon RDS zero-ETL integrations with an Amazon SageMaker lakehouse](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/zero-etl.creating-smlh.html)
