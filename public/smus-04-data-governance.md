---
title: SageMaker Unified Studio でデータガバナンスを実装する（個人情報分類・統制語彙・列レベルアクセス制御）
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - datacatalog
  - データガバナンス
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: true
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## はじめに

SageMaker Unified Studio（DataZone V2）でデータカタログを整備していくと、「個人情報をどう分類・管理するか」「特定の列だけ見せたい／隠したい」といったデータガバナンスの要件に必ず突き当たります。

本記事では、実際にメタデータ整備を進める中で得た、SageMaker Unified Studio におけるデータガバナンス実装の勘所を整理します。具体的には次のトピックを扱います。

- データガバナンスは「**分類（記録）**」と「**アクセス制御（実行）**」の2層で考える
- 個人情報などの分類は、**カラムには README ではなくグロサリー用語**で付与するのが素直
- カスタムメタデータフォームのフィールドに**グロサリー用語集を紐付けて統制語彙（選択式）**にできる
- 列・行レベルのアクセス制御は**アセットフィルター**で行い、購読ごとに出し分けられる

アセットの基本やビジネスコンテキストの付け方は、以下の記事で解説しています。あわせて参照してください。

- [【SageMaker Unified Studio 入門】「アセットって結局なに？」を図解で理解して、Glue テーブルから作ってみる【AWS CLI】](https://qiita.com/swkky/items/092df5056ee13b7a9297)
- [Data Agent 活用の観点で付与すべきビジネスコンテキストと優先度](https://qiita.com/swkky/items/9bbb5a7251b3a8adf063)

:::note
本記事の仕様は公式ドキュメントおよび実際の API 挙動の確認に基づいていますが、UI の細部や仕様は変わる可能性があります。設計・分類の方針部分には筆者の見解を含みます。
:::

## データガバナンスは「分類」と「アクセス制御」の2層で考える

データガバナンスというと漠然としますが、SageMaker Unified Studio 上では大きく2つの層に分けて考えると整理しやすいです。

| 層 | 役割 | 手段 |
|---|---|---|
| **分類（記録）** | 「どのデータ・どの列が、どんな機微度か」をメタデータとして記録する | グロサリー用語、メタデータフォーム |
| **アクセス制御（実行）** | 記録した分類を根拠に「誰に何を見せるか」を制御する | サブスクリプション承認、アセットフィルター（Lake Formation） |

重要なのは、**この2層は補完関係**だということです。分類だけしても実際のアクセスは変わりませんし、分類なしにアクセス制御を設計するのは困難です。「まず分類で機微な列を特定し、それを根拠に列レベルのアクセス制御を設計する」という流れが基本になります。

以降、それぞれの層で押さえるべきポイントを見ていきます。

## 分類層: カラムには README ではなくグロサリー用語

### メタデータの付与先ごとの役割分担

SageMaker Unified Studio では、アセット（テーブル）とカラムのそれぞれにメタデータを付けられます。公式ドキュメント（[Manage inventory and curate assets](https://docs.aws.amazon.com/datazone/latest/userguide/update-metadata.html)）を読むと、付与先ごとに想定されている役割が異なることが分かります。

| 付与先 | 付けられるもの |
|---|---|
| **アセット** | Business Name / Description / README / グロサリー用語 / メタデータフォーム |
| **カラム** | Business Name / Description / **グロサリー用語** |

ポイントは、**カラムレベルで整備できるものとして公式に挙げられているのは business name / description / glossary terms の3つ**で、**メタデータフォーム（custom form）は主にアセットレベルの仕組み**という点です。

> Metadata forms ... attached to an asset type are applied to all assets created from that asset type.

つまり「カラム単位で個人情報区分などの分類を構造化して管理したい」場合、**最も素直な手段はグロサリー用語（glossary term）の付与**です。カラムにフォームを付ける API（`batch-put-attributes-metadata`）自体は存在しますが、Unified Studio の UI からは参照、変更が出来なさそうでした。

### なぜ README ではなくグロサリー用語なのか

「この列は個人情報」という情報を README や description に文章で書くこともできますが、それだと構造化されず、検索・フィルタ・集計に使えません。グロサリー用語で付与すると次の利点があります。

- **用語集で語彙が統一される**（表記ゆれが構造的に起きない）
- **検索・フィルタで横断的に扱える**（「この用語が付いた列を持つアセット」を探せる）
- **Data Agent のマッチング入力**になる
- **アクセス制御設計の根拠**として再利用できる

### 分類は「全列」ではなく「該当列のみ」で十分

個人情報分類のような用途では、**全カラムに用語を付ける必要はありません**。目的は「機微な列を漏れなく特定すること」なので、次の運用が費用対効果に優れます。

- 個人情報を含む列 → 分類用語を**必ず**付与
- 判定保留（実データ未確認等）の列 → 「不明」用語を**明示的に**付与（「用語なし」と区別）
- 個人情報を含まない列 → **付けない**（「用語なし ＝ 該当なし」と解釈）

「全列に付与」は網羅性の証明にはなりますが、大規模テーブルでは大半が非該当列の機械的付与になり労力の割に情報が薄くなります。「該当列のみ」に絞るのが実務的です。

### 補足: restricted（制限付き）分類はアセットレベルのみ

分類ラベルは「誰でも付け外しできると困る」ため、SageMaker Unified Studio には**制限付き分類用語（restricted classification / governed terms）**という、付与できるユーザーを制限できる仕組みがあります（[Restricted asset classification](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/restricted-asset-classification.html)）。

ただし現時点で重要な制約があります。

> Restricted glossary terms are currently supported only at the asset level. **Column-level terms, metadata form–level terms and data product-level terms are not currently supported.**

つまり **制限付き用語はカラムには使えません**。カラム分類は通常（unrestricted）のグロサリー用語で行い、統制は運用ルールで担保する、という整理になります。統制を効かせたい分類はアセットレベルで restricted 用語を使う、という使い分けが現実的です。

## 分類層: メタデータフォームで統制語彙（選択式）を実現する

アセットのガバナンス情報（ソースシステム、データオーナー、個人情報区分など）は、カスタムメタデータフォームで管理できます。ここで「個人情報区分」のような項目を**自由記述にすると表記ゆれが必ず起きる**ため、選択肢（統制語彙）にしたくなります。

### enum は使えない。glossaryterm 参照で実現する

DataZone のフォームタイプは Smithy モデルで定義しますが、**Smithy の `enum` 型・`@enum` トレイトはサポートされていません**（`CreateFormType` でバリデーションエラーになります）。

代わりに使うのが **`@amazon.datazone#glossaryterm` トレイト**です。フィールドに用語集を紐付けると、そのフィールドは「指定した用語集の用語IDを格納するフィールド」になります（[CreateFormType](https://docs.aws.amazon.com/datazone/latest/APIReference/API_CreateFormType.html)）。

```
structure DLHDataAttributes {
  sourceSystem: String,
  dataOwner: String,
  @amazon.datazone#glossaryterm("<glossary_id>")
  personalInfoClass: String,
  dataCategory: String,
  note: String
}
```

このトレイトを付けると、次の挙動になります。

- **UI では用語集からの選択式（ドロップダウン）**になり、自由記述できない
- 値は内部的に**グロサリー用語のID**で格納される
- **Search / SearchListings API でフィルタ可能**になる（enum より高機能）

実際に、選択肢を用語集に紐付けたフィールドは UI 上できちんとプルダウンになります。「enum が使えないから統制語彙は無理」ではなく、**用語集を単一の統制ソースとして UI 選択式・検索フィルタ・ID 管理を同時に満たせる**わけです。

### 選択肢の増減は「フォーム定義」ではなく「用語集」で

この設計のうれしい副作用として、**選択肢を増減するときにフォーム定義を触る必要がありません**。用語集に用語を追加・変更するだけで、フォームの選択肢に反映されます（フォームは用語集を参照しているだけなので）。ガバナンス用語の管理を用語集に一元化できます。

### CLI での作成例

```bash
# 用語集に分類用語を追加（選択肢の追加はこちら側で行う）
aws datazone create-glossary-term \
  --domain-identifier <domain-id> \
  --glossary-identifier <glossary-id> \
  --name "個人情報あり（要注意）" \
  --short-description "氏名・電話・住所・メールを直接含むデータ" \
  --status ENABLED

# glossaryterm 参照フィールドを持つフォームタイプを作成
aws datazone create-form-type \
  --domain-identifier <domain-id> \
  --owning-project-identifier <project-id> \
  --name DLHDataAttributes \
  --model 'smithy=structure DLHDataAttributes { ... @amazon.datazone#glossaryterm("<glossary-id>") personalInfoClass: String ... }' \
  --status ENABLED
```

> `create-form-type`（フォーム定義）や `create-glossary-term`（用語追加）は共有ドメインへの変更です。適用前に内容を確認する運用にしておくと安全です。

### 分類の判定基準は用語の説明に書いておく

用語集の各用語には説明（long description）を書けます。ここに**判定基準**を明記しておくと、「この列はどの分類か」を迷わず決められます。例:

- 個人情報なし … 個人を特定できる情報を一切含まない
- 個人情報あり（匿名化済み） … 会員ID等の**間接識別子のみ**で個人に紐づく
- 個人情報あり（要注意） … 氏名・電話・住所・メール等の**直接識別子**を含む
- 不明 … 有無が未判定

判定は用語の説明に従って機械的に決められるようにしておくのが、運用のブレを防ぐコツです。

## アクセス制御層: アセットフィルターで列・行を絞る

分類で「どの列が機微か」を特定したら、それを根拠に実際のアクセスを制御します。

### アセットを分けるのは NG

よくある誤解が「個人情報を含むアセットと含まないアセットを別々に作る」というものですが、これは**アクセス制御にはなりません**。アセットを分けても裏の S3/Glue の実データは同じで、権限のあるユーザーは元テーブルを直接クエリできます。カタログ上でアセットを分けるのは「見かけの分離」にすぎません。

### 正攻法: 1アセット + アセットフィルター

SageMaker Unified Studio の正攻法は、**1つのアセットに対してアセットフィルター（列フィルター・行フィルター）を定義し、サブスクリプション承認時に適用する**方式です（[Grant access with filters](https://docs.aws.amazon.com/datazone/latest/userguide/grant-access-with-filters.html)）。

- 列フィルター … 参照を許可（または除外）する**列**を指定
- 行フィルター … 参照を許可する**行**を条件式で指定

購読が承認されると、DataZone がこのフィルターを **Lake Formation の Data Cell Filter** に変換し、購読プロジェクトには**許可された列・行だけに SELECT 権限**が付与されます。カタログ上の見かけではなく、**Lake Formation による物理的なアクセス制御**として効くのが重要な点です。

### 購読（プロジェクト）ごとに出し分けられる

フィルターは「アセットに常時適用される」のではなく、**用意しておいたフィルターの中から、サブスクリプション承認時に選んで適用**します。サブスクリプションはプロジェクト単位で発生するため、結果として**プロジェクトごとに見える列を変える**ことができます。

- 経営分析プロジェクトからの購読 → 承認時にフィルターなし（フルアクセス）→ 個人情報を含む全列
- 全社分析プロジェクトからの購読 → 承認時に「個人情報列を除外」フィルター → 非個人情報列のみ

適用したフィルターは、データオーナー側から UI（購読一覧）や API（`list-subscription-grants` の `assetScope.filterIds`）で後から確認できます。

### 注意点

- フィルターの粒度は**購読プロジェクト単位**。同一プロジェクト内のメンバー間で出し分けることはできません（その場合はプロジェクトを分割）。
- フィルターは**承認時に手動で選ぶ**運用です。自動承認（承認不要）にするとフィルターを挟めず全列が共有されます。
- 「PII 列を含まない実体」を提供したい場合は、Glue View / CTAS で派生ビューを作り、それを別アセットとして公開します（この場合は実体が本当に別なので、アセットを分けることが有効な分離になります）。

## まとめ

SageMaker Unified Studio でデータガバナンスを実装する際の要点をまとめます。

- データガバナンスは「**分類（記録）**」と「**アクセス制御（実行）**」の2層で考える。分類が制御の根拠になる。
- **カラムの分類は README ではなくグロサリー用語**で付与する。構造化され、検索・フィルタ・Data Agent・アクセス制御設計に再利用できる。全列ではなく該当列のみで十分。
- 制限付き（restricted）分類用語は**現状アセットレベルのみ**。カラムは通常のグロサリー用語で分類する。
- メタデータフォームで統制語彙（選択式）を作るには、**enum ではなく `@amazon.datazone#glossaryterm` トレイト**を使う。UI 選択式・検索フィルタ・ID 管理を同時に満たせる。選択肢の増減は用語集側で行う。
- 列・行レベルのアクセス制御は**アセットフィルター**で行い、Lake Formation の Data Cell Filter として物理的に効く。購読（プロジェクト）ごとに出し分けられる。**アセットを複製するのは制御にならない**。

分類メタデータの整備は地道な作業ですが、ここを固めておくと、後の列レベルアクセス制御や Data Agent 活用がスムーズになります。「まず機微な列を用語で特定し、それを根拠にフィルターで制御する」という流れを意識すると、ガバナンス施策が一貫します。

## 参考

- [Manage inventory and curate assets in Amazon DataZone](https://docs.aws.amazon.com/datazone/latest/userguide/update-metadata.html)
- [Restricted asset classification in Amazon SageMaker Unified Studio](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/restricted-asset-classification.html)
- [CreateFormType API](https://docs.aws.amazon.com/datazone/latest/APIReference/API_CreateFormType.html)
- [Grant access with filters in Amazon DataZone](https://docs.aws.amazon.com/datazone/latest/userguide/grant-access-with-filters.html)
- [Best practice 7.1 – Build a central Data Catalog（Analytics Lens）](https://docs.aws.amazon.com/wellarchitected/latest/analytics-lens/best-practice-7.1---build-a-central-data-catalog-to-store-share-and-track-metadata-changes..html)
