---
title: SageMaker Unified Studio におけるデータ活用・ガバナンスの肝「アセット」を深掘りしてみる
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - glue
  - datacatalog
private: false
updated_at: '2026-08-31T17:28:14+09:00'
id: 092df5056ee13b7a9297
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

本記事は、SageMaker Unified Studio を使ったデータカタログ構築の入門記事です。  
そもそも「アセット」とは何か、なぜ必要なのかといった概念を整理します。

「Unified Studio を触り始めたけれど、アセットという言葉が出てきてもピンとこない」「Glue テーブルを Unified Studio のカタログに登録したいが、どういう仕組みで、どんな準備が必要なのか分からない」といった方に向けた内容です。

<!-- なお、AWS CLI を使って Glue テーブルから実際にアセットを作成する具体的な手順は、別記事にまとめています。手を動かして試したい方は本記事のあとに以下をご覧ください。

👉 [SageMaker Unified Studio で Glue テーブルからアセットを作成する（AWS CLI 手順）](https://qiita.com/swkky/items/) -->

### この記事で解説すること

- アセットとは何か
- ドメイン・プロジェクト・アセットの関係性、パブリッシュとサブスクリプションの仕組み
- なぜアセットが必要なのか

### 前提知識

- Glue Data Catalog（データベース / テーブル）の基礎知識
- Lake Formation の概要（権限管理の考え方）を知っていると理解がスムーズです

## アセットとは?

SageMaker Unified Studio（DataZone）における「[アセット](https://docs.aws.amazon.com/ja_jp/datazone/latest/userguide/datazone-concepts.html#datazone-terms)」とは、テーブルやビューなどの**データオブジェクトに対応するカタログ上の管理単位**です。

- Glue テーブル 1 つ = アセット 1 つ
- アセットにはビジネス名、Description、グロサリー用語、メタデータフォーム等のビジネスコンテキストを付与できる
- Glue Data Catalog と同じで実データではなく、**メタデータの管理単位**です。

#### 具体例: Glue テーブル `sales_transactions` をアセット化した場合

例えば、Glue Data Catalog 上に `sales_transactions` というテーブルがあるとします。このテーブルをアセットとして登録し、ビジネスコンテキストを付与すると以下のようになります。
アセットは、Glue Data Catalog で保持されているスキーマ、S3 Location などの技術的なメタデータも包含しています。
Glue Data Catalog を拡張した概念というイメージで良いと思います。

| 項目 | テクニカル情報（Glue Data Catalog 側） | ビジネスコンテキスト（アセット側で付与） |
|------|--------------------------|----------------------------------------|
| **名前** | `sales_transactions` | 売上トランザクション |
| **説明** | *(なし)* | EC サイトにおける全注文の売上明細データ。1 行 = 1 注文明細。返品・キャンセルを含む |
| **グロサリー用語** | — | 「売上」「注文」「トランザクション」 |
| **カラム: `txn_amt`** | DOUBLE 型 | ビジネス名: 取引金額（税込）、説明: 消費税込みの決済金額（日本円） |
| **カラム: `cust_id`** | STRING 型 | ビジネス名: 顧客 ID、説明: 顧客マスタの主キーと結合可能 |
| **メタデータフォーム** | — | データオーナー: セールスチーム、更新頻度: 日次、PII 有無: なし |

このように、Glue 側のテーブル名 (sales_transactions) やカラム名 (txn_amt) だけでは分からない「このデータは何を意味するのか」「誰が管理しているのか」「データの更新頻度」といったビジネス上の文脈を付与できるのがアセットです。

なお、Glue テーブル/ビューだけでなく、以下のような対象にアセットを作成することも可能です。

| 対象 | 補足 |
|--------|-----------|
| Redshift テーブル/ビュー | None |
| S3 オブジェクトコレクション | Amazon S3 バケット/プレフィックス内のオブジェクト集合 |
| 機械学習リソース | SageMaker モデル、パイプライン、学習用データセット、Jupyter Notebook 等 |
| BI / 可視化ダッシュボード | Amazon QuickSight, Tableau, Power BI 等のレポート |

SageMaker Unified Studio でのアセットの役割を理解する上で、**ドメイン**と**プロジェクト**との関係性の理解が必要ですが、以下のようなイメージになります。

```mermaid
graph TB
    subgraph Domain["🏢 ドメイン（SageMaker Unified Studio）"]
        direction TB
        Catalog["📚 共有カタログ"]
        
        subgraph ProjA["📁 セールスプロジェクト"]
            A1["アセット: 商談履歴"]
            A2["アセット: 顧客マスタ"]
        end
        
        subgraph ProjB["📁 マーケティングプロジェクト"]
            B1["アセット: キャンペーン実績"]
            B2["アセット: リード情報"]
        end
    end

    A1 -.->|パブリッシュ| Catalog
    A2 -.->|パブリッシュ| Catalog
    B1 -.->|パブリッシュ| Catalog
```

| 概念 | 説明 |
|------|------|
| **ドメイン** | 組織全体のデータガバナンスの最上位単位 |
| **プロジェクト** | ドメイン内のチーム単位の作業空間。アセットの所有権、IAM ロール、接続情報がプロジェクトに紐づく |
| **アセット** | プロジェクトに所属するカタログ上の管理単位。パブリッシュによりドメイン内の全プロジェクトに公開される |

### プロジェクト分割の方針

[プロジェクト](https://docs.aws.amazon.com/ja_jp/sagemaker-unified-studio/latest/userguide/projects.html)は**データのアクセス制御の境界**です。以下のような観点で分割するのが一般的だと考えています。

| 分割パターン | 例 |
|-------------|-----|
| チーム/部署単位 | セールス / マーケティング / 経営 |
| 事業ドメイン単位 | 食料品ドメイン / 日用品ドメイン / 医薬品ドメイン |

### パブリッシュとサブスクリプション

アセットの**パブリッシュ**と**サブスクリプション**は、プロジェクト間でデータを共有するための仕組みです。

以下の図で、セールスプロジェクトがアセットをパブリッシュし、マーケティングプロジェクトがサブスクリプションを通じて実データにアクセスするまでの流れを示します。

```mermaid
graph TB
    subgraph Domain["🏢 ドメイン"]
        subgraph Sales["📁 セールスプロジェクト（データオーナー）"]
            Asset["アセット: 顧客マスタ<br/>+ ビジネスメタデータ"]
        end

        subgraph Catalog["📚 共有カタログ（ドメイン全体に公開）"]
            Published["顧客マスタ<br/>🔍 全プロジェクトから探索・発見可能"]
        end

        subgraph Marketing["📁 マーケティングプロジェクト（データ利用者）"]
            Query["実データへのクエリ実行"]
        end
    end

    Asset -->|"① パブリッシュ<br/>（メタデータのみ公開）"| Published
    Published -->|"② 検索で発見"| Marketing
    Marketing -->|"③ サブスクリプション申請"| Sales
    Sales -->|"④ 承認 → アクセス権自動付与"| Query
```

:::note info
パブリッシュするとドメイン内の**全プロジェクトからアセットを探索・発見できる**ようになりますが、**実データを参照するにはサブスクリプション（申請→承認）が必要**です。
:::

## なぜアセットが必要？

### 1. データコラボレーション

アセットを作成してパブリッシュすることで、ドメインに属する**全プロジェクトのメンバーがカタログからデータを探索・発見できる**ようになります。さらに、サブスクリプション（申請→承認）を通じて実データへのアクセス権が付与されるため、データオーナーがガバナンスを維持しながらも、チーム間のデータコラボレーションをスムーズに実現できます。  
複数のアセットを一つの[データプロダクト](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-products.html)としてまとめてパブリッシュ/サブスクリプションしたりもできます。

### 2. データガバナンス

アセットは単にデータを共有するだけでなく、**サブスクリプション（申請→承認）を軸にしたアクセス制御**の起点になります。前述の通り、パブリッシュしても実データの参照にはサブスクリプションが必要で、データオーナーが承認することで初めてアクセス権が付与されます。

さらに、承認時に **アセットフィルター（Asset Filter）** を適用することで、**同じアセット（＝同じ Glue テーブル）でも、購読するプロジェクトごとに参照できる列・行を変える**ことができます。

#### アセットフィルターとは

アセットフィルターは、アセットに対して定義しておく「参照可能な列・行の絞り込み設定」です。

| フィルター種別 | 用途 |
|-------------|------|
| **カラムフィルター** | 参照を許可する**列**を指定 |
| **行フィルター** | 参照を許可する**行**を条件式で指定 |

#### プロジェクトごとにフィルターを出し分ける

サブスクリプションは**プロジェクト単位**で発生します。承認者はサブスクリプション要求ごとに「フルアクセス」か「フィルター適用」かを選べるため、結果として**プロジェクトごとに異なるフィルターを適用**できます。

例えば「個人情報を含む売上テーブル」を 1 つのアセットとして公開し、プロジェクトに応じて次のように出し分けられます。

```mermaid
graph TB
    subgraph Owner["📁 データオーナープロジェクト"]
        Asset["アセット: 売上トランザクション<br/>（会員ID・氏名を含む全カラム）"]
        F1["フィルター A: 全カラム"]
        F2["フィルター B: 個人情報カラムを除外"]
    end

    subgraph AnalyticsA["📁 経営分析プロジェクト"]
        UseA["会員IDを含む全カラムを参照"]
    end

    subgraph AnalyticsB["📁 全社分析プロジェクト"]
        UseB["個人情報を除いたカラムのみ参照"]
    end

    Asset --- F1
    Asset --- F2
    F1 -->|"承認時に<br/>フィルターA を適用"| UseA
    F2 -->|"承認時に<br/>フィルターB を適用"| UseB
```

- 経営分析プロジェクトからの購読 → 承認時に **フィルター A（全カラム）** を適用 → 個人情報を含む全列を参照可能
- 全社分析プロジェクトからの購読 → 承認時に **フィルター B（個人情報カラム除外）** を適用 → 個人情報なしの列のみ参照可能

承認されたフィルターは **AWS Lake Formation の Data Cell Filter** に変換され、購読プロジェクトのメンバーには**許可された列・行のみに SELECT 権限**が付与されます。

<!-- :::note warn
フィルターの適用粒度は**購読プロジェクト単位**です。同一プロジェクト内のメンバー間で「A さんは個人情報可、B さんは不可」といった出し分けはできません。その場合はプロジェクト自体を分割します。また、フィルターは**承認時に手動で選択**する運用のため、自動承認（承認不要設定）にするとフィルターを挟めず全カラムが共有される点にも注意が必要です。
:::

#### 適用したフィルターの確認

データオーナー（アセットを公開したプロジェクトのメンバー）は、「どの購読プロジェクトにどのフィルターを適用したか」を後から確認できます。UI では公開プロジェクトの **Data タブ → 購読一覧**から各購読の適用フィルターを確認でき、API では `list-subscriptions` / `list-subscription-grants` で購読を一覧し、各グラントに含まれる `assetScope.filterIds` から適用されているフィルターの ID を取得できます。 -->

### 3. Data Agent の活用

[SageMaker Data Agent](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-agent-business-catalog.html) ではアセットに付与されたビジネスメタデータを参照して、自然言語でデータセットを探索したり、SQL、Python などのコード生成を行うことが出来ます。Data Agent を活用した **AI Ready なデータ基盤**を構築する上で、アセット登録とビジネスメタデータの整備は重要です。  
具体的にはアセット、ビジネスメタデータを整備することで Data Agent を利用して以下のようなことが可能になります。

1. データの探索
- 「顧客離脱に関するデータはありますか？」
  - 該当するデータを保有する可能性があるアセットを一覧で提示してくれる。

2. コード生成
- 「2026 年 Q3-Q4 における顧客維持率を計算してください。」
  - 適切なテーブル(アセット)とカラムを使用して、SQL or PySpark コードを生成してくれる。


なお、現時点で SageMaker Data Agent は Unified Studio 内のノートブック、クエリエディタからのみ利用可能です。

<!-- ## Glue テーブルからアセットを作成するには

ここまでで、アセットとは何か、なぜ必要なのかという概念を整理してきました。実際に AWS CLI を使って **Glue テーブルに対するデータソースを作成し、データソースランを実行してアセットを生成する**具体的な手順は、別記事にまとめています。手を動かして試したい方は以下をご覧ください。

👉 [SageMaker Unified Studio で Glue テーブルからアセットを作成する（AWS CLI 手順）](https://qiita.com/swkky/items/) -->

## 次の記事

別の記事ではアセットに付与できるビジネスコンテキスト、AWS CLIでの付与方法について紹介しています。

👉 [Data Agent 活用の観点で SageMaker Unified Studio のアセットに付与すべきビジネスコンテキストと優先度](https://qiita.com/swkky/items/9bbb5a7251b3a8adf063)
👉 [SageMaker Unified Studio アセットにビジネスメタデータをAWS CLIから付与する](https://qiita.com/swkky/items/d84b98fceff972c14fa4)

## 参考

- [Create an Amazon SageMaker Unified Studio data source for AWS Glue in the project catalog](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/data-source-glue.html)
- [Configure Lake Formation permissions for Amazon SageMaker Unified Studio](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/lake-formation-permissions-for-amazon-sagemaker-unified-studio.html)
- [Asset revisions in Amazon DataZone](https://docs.aws.amazon.com/datazone/latest/userguide/asset-versioning.html)
