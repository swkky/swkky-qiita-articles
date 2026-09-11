---
title: SageMaker Unified Studio でサブスクリプション申請時にフォーム記入を必須化するルールを AWS CLI で作成する
tags:
  - AWS
  - SageMakerUnifiedStudio
  - DataZone
  - datacatalog
  - awscli
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

SageMaker Unified Studio（DataZone V2）では、データ利用者がアセットにアクセスしたいとき **サブスクリプション（Subscribe）を申請** します。このとき「何のために・いつまで使うのか」を必ず申告させたい、というのはデータガバナンスの基本的な要求です。

これを実現するのが **サブスクリプション申請時のメタデータ強制ルール（Metadata enforcement rule / action `CREATE_SUBSCRIPTION_REQUEST`）** です。申請フォームに任意のメタデータフォーム（例: 利用目的フォーム）を添付・入力させることを必須化できます。

本記事では、

1. 利用目的フォーム（`UsagePurposeForm`）を作る
2. 「利用期間」を選択式にするためのグロサリー用語集を作る
3. サブスクリプション申請時ルールを `create-rule` で作る

までを、実際に実行して確認したコマンドで解説します。あわせて検証中に確認した **重複制約** も触れます。

公開時ルール（アセットをカタログに公開する時点での強制）については、対になる記事を参照してください。

- [SageMaker Unified Studio でアセット公開時に必須メタデータを強制するルールを AWS CLI で作成する](https://qiita.com/swkky/items/xxxxxxxxxxxx)（※公開後にリンク差し替え）

:::note
本記事のコマンドは実環境（`ap-northeast-1`）で実行して動作確認しています。UI の細部や仕様は変わる可能性があります。
:::

## 全体像: 「申請時に必ず入力させる」の2段構え

公開時ルールと同様、サブスクリプション申請時の強制も **2段構え** です。

| レイヤー | 仕組み | 効果 |
|---|---|---|
| ① フォーム定義 | フィールドに `@required` | フォームを添付したときに、その項目を必須にする |
| ② サブスク申請ルール | `create-rule`（`action = CREATE_SUBSCRIPTION_REQUEST`） | サブスクリプション申請時に、そのフォームの添付を必須にする |

- ①だけ → フォームを添付しなければ素通り
- ②だけ → フォームは添付必須だが、中身が空でも通りうる
- **①＋② → 申請時に必ずその項目が埋まる**

## 前提

- AWS CLI v2 がインストール・設定済みであること
- ルール・フォームタイプ・グロサリーを作成する権限があること（ドメインユニットのオーナー相当）

変数:

```bash
DOMAIN_ID=dzd-xxxxxxxxxxxxxx        # DataZone / SMUS ドメインID
REGION=ap-northeast-1
PROFILE=your-profile
PROJECT_ID=xxxxxxxxxxxxxx           # フォーム/用語集を所有するプロジェクトID
```

## STEP 1: 「利用期間」を選択式にするグロサリー用語集を作る

今回作りたい利用目的フォームの要件は次のとおりです。

| フィールド | 要件 |
|---|---|
| 利用目的 | 必須・自由記述テキスト |
| 利用期間 | 必須・**選択式**（1ヶ月 / 3ヶ月 / 6ヶ月 / 1年 / 恒久） |
| 関連プロジェクト | 任意・自由記述テキスト |

ここで問題になるのが「利用期間の選択式」です。**DataZone のフォームタイプ（Smithy モデル）は `enum` 型・`@enum` トレイトをサポートしません**。選択肢（統制語彙）を実現する手段は **グロサリー用語集の参照（`@amazon.datazone#glossaryterm`）** です。用語集を選択肢の一覧として使い、UI ではドロップダウン選択になります。

まず用語集を作ります。

```bash
aws datazone create-glossary \
  --domain-identifier "$DOMAIN_ID" \
  --owning-project-identifier "$PROJECT_ID" \
  --name "サブスクリプション利用期間区分" \
  --description "サブスクリプション（データ利用申請）における利用期間の統制語彙。UsagePurposeForm の利用期間フィールドで参照する。" \
  --status ENABLED \
  --region "$REGION" --profile "$PROFILE"
```

レスポンスの `id`（例: `d9btorh6f1dnkp`）を控えます。

```bash
GLOSSARY_ID=d9btorh6f1dnkp
```

続いて選択肢となる5つの用語を登録します。

```bash
for term in "1ヶ月" "3ヶ月" "6ヶ月" "1年" "恒久"; do
  aws datazone create-glossary-term \
    --domain-identifier "$DOMAIN_ID" \
    --glossary-identifier "$GLOSSARY_ID" \
    --name "$term" \
    --short-description "利用期間 $term" \
    --status ENABLED \
    --region "$REGION" --profile "$PROFILE"
done
```

各用語の `id` が発行されます（例）。

| 用語 | 用語ID |
|---|---|
| 1ヶ月 | `azq233gd0901sp` |
| 3ヶ月 | `an3svo11p4s3vd` |
| 6ヶ月 | `65u20whjq37frt` |
| 1年 | `c9nsxvycsbdfa1` |
| 恒久 | `avzc4f8t4ybymx` |

:::note info
選択肢を増減したいときは、フォーム定義ではなく **用語集に用語を追加・変更** します（`create-glossary-term`）。フォーム側は用語集を参照しているだけなので改修不要です。
:::

## STEP 2: 利用目的フォーム（UsagePurposeForm）を作る

`create-form-type` で作成します。Smithy モデルのポイントは以下です。

- `@required` … 必須フィールド（利用目的・利用期間）
- `@amazon.datazone#glossaryterm("<用語集ID>")` … そのフィールドを用語集参照（選択式）にする
- グロサリー参照フィールドの型は **`String` の `list`**（1つだけ選択なら `@length(min:1, max:1)`）にする

```bash
aws datazone create-form-type \
  --domain-identifier "$DOMAIN_ID" \
  --owning-project-identifier "$PROJECT_ID" \
  --name UsagePurposeForm \
  --status ENABLED \
  --model 'smithy=@length(min:1, max:1)
list UsagePeriodList {member: String}
structure UsagePurposeForm {
@required
usagePurpose: String,
@amazon.datazone#glossaryterm("'"$GLOSSARY_ID"'")
@required
usagePeriod: UsagePeriodList,
relatedProject: String
}' \
  --region "$REGION" --profile "$PROFILE"
```

:::note warn
**グロサリー紐付けフィールド（`usagePeriod`）の型は `String` ではなく「`String` の `list`（配列）」にします。** 用語を1つだけ選ばせたい場合でも、`@length(min:1, max:1)` を付けた `list` 型で定義するのが正しい仕様です。

`usagePeriod: String` のように `String` 型で定義すると、UI からサブスクリプション申請を送信したときに次のエラーが発生し、申請できません。

```text
$.UsagePurposeForm.usagePeriod: array found, string expected
```

これは、UI がグロサリー選択値を**配列**として送信する一方、フォーム定義が `String`（単一値）を期待するために起きる型不一致です。UI からグロサリー紐付けフィールドを作成すると内部的には必ず `@length(min:1, max:1) list ... {member: String}` の形で生成されるため、CLI でも同じ `list` 型に合わせます。
:::

レスポンス:

```json
{
    "domainId": "dzd-xxxxxxxxxxxxxx",
    "name": "UsagePurposeForm",
    "revision": "1"
}
```

`get-form-type` で定義を確認できます。

```bash
aws datazone get-form-type \
  --domain-identifier "$DOMAIN_ID" \
  --form-type-identifier UsagePurposeForm \
  --region "$REGION" --profile "$PROFILE"
```

```json
{
    "name": "UsagePurposeForm",
    "revision": "1",
    "model": {
        "smithy": "@length(min:1, max:1)\nlist UsagePeriodList {member: String}\nstructure UsagePurposeForm {\n@required\nusagePurpose: String,\n@amazon.datazone#glossaryterm(\"d9btorh6f1dnkp\")\n@required\nusagePeriod: UsagePeriodList,\nrelatedProject: String\n}"
    },
    "status": "ENABLED"
}
```

これで「利用目的（必須テキスト）」「利用期間（必須・用語集選択）」「関連プロジェクト（任意テキスト）」を持つフォームができました。

## STEP 3: ターゲットとなるドメインユニットIDを確認する

ルールはドメインユニットに紐付きます。ドメイン全体に効かせたい場合は **ルートドメインユニット** を対象にします。

```bash
aws datazone get-domain \
  --identifier "$DOMAIN_ID" \
  --region "$REGION" --profile "$PROFILE" \
  --query 'rootDomainUnitId' --output text
```

```bash
DOMAIN_UNIT_ID=5j0d7yrs9ao0ex   # ↑で取得した rootDomainUnitId
```

## STEP 4: サブスクリプション申請時ルールを作成する

`create-rule` で作成します。公開時ルールとの違いは **`--action` が `CREATE_SUBSCRIPTION_REQUEST`** である点だけです。

- `--action CREATE_SUBSCRIPTION_REQUEST` … 「サブスクリプション申請」に効くルール
- `--detail` に `metadataFormEnforcementDetail.requiredMetadataForms` … 必須にするフォームを **`typeIdentifier` + `typeRevision`** で指定（最大5つ）
- `--scope` … 対象のアセット型・データプロダクト・プロジェクトを絞る
- `--target` … 対象ドメインユニット。`includeChildDomainUnits: true` で子ユニットにも継承

```bash
aws datazone create-rule \
  --domain-identifier "$DOMAIN_ID" \
  --name Subscribe-Require-UsagePurpose \
  --action CREATE_SUBSCRIPTION_REQUEST \
  --scope '{
    "assetType": {
      "selectionMode": "SPECIFIC",
      "specificAssetTypes": [
        "amazon.datazone.GlueTableAssetType",
        "amazon.datazone.GlueViewAssetType",
        "amazon.datazone.RedshiftTableAssetType",
        "amazon.datazone.RedshiftViewAssetType"
      ]
    },
    "dataProduct": true,
    "project": { "selectionMode": "ALL" }
  }' \
  --target '{
    "domainUnitTarget": {
      "domainUnitId": "'"$DOMAIN_UNIT_ID"'",
      "includeChildDomainUnits": true
    }
  }' \
  --detail '{
    "metadataFormEnforcementDetail": {
      "requiredMetadataForms": [
        { "typeIdentifier": "UsagePurposeForm", "typeRevision": "1" }
      ]
    }
  }' \
  --description "UsagePurposeForm をサブスクリプション申請時に必須化" \
  --region "$REGION" --profile "$PROFILE"
```

レスポンス例:

```json
{
    "identifier": "3m1pglsu6lxp21",
    "name": "Subscribe-Require-UsagePurpose",
    "ruleType": "METADATA_FORM_ENFORCEMENT",
    "action": "CREATE_SUBSCRIPTION_REQUEST",
    "target": {
        "domainUnitTarget": { "domainUnitId": "5j0d7yrs9ao0ex", "includeChildDomainUnits": true }
    },
    "scope": {
        "assetType": {
            "selectionMode": "SPECIFIC",
            "specificAssetTypes": [
                "amazon.datazone.GlueTableAssetType",
                "amazon.datazone.GlueViewAssetType",
                "amazon.datazone.RedshiftTableAssetType",
                "amazon.datazone.RedshiftViewAssetType"
            ]
        },
        "dataProduct": true,
        "project": { "selectionMode": "ALL" }
    },
    "detail": {
        "metadataFormEnforcementDetail": {
            "requiredMetadataForms": [
                { "typeIdentifier": "UsagePurposeForm", "typeRevision": "1" }
            ]
        }
    },
    "targetType": "DOMAIN_UNIT"
}
```

:::note info
`create-rule` に `ruleType` パラメータはありません。`--detail` に `metadataFormEnforcementDetail` を渡すと、`ruleType` は自動的に `METADATA_FORM_ENFORCEMENT` になります。ルールの種別（公開/申請）を決めているのは **`--action`** です。
:::

## STEP 5: 作成したルールを確認する

一覧は `list-rules`。`--action` で絞り込めます。

```bash
aws datazone list-rules \
  --domain-identifier "$DOMAIN_ID" \
  --target-type DOMAIN_UNIT \
  --target-identifier "$DOMAIN_UNIT_ID" \
  --action CREATE_SUBSCRIPTION_REQUEST \
  --region "$REGION" --profile "$PROFILE"
```

個別の詳細（`detail` 含む）は `get-rule`:

```bash
aws datazone get-rule \
  --domain-identifier "$DOMAIN_ID" \
  --identifier 3m1pglsu6lxp21 \
  --region "$REGION" --profile "$PROFILE"
```

:::note warn
`list-rules` の `--target-identifier` には **ドメインID ではなく domain unit ID** を渡します。ドメインID（`dzd-...`）を渡すと `AccessDeniedException` になります。
:::

## ハマりどころ: 同一内容のルールは名前を変えても作れない

これは公開時ルールと同じ制約です。既に同じ内容のルールがある状態で名前だけ変えて `create-rule` すると、次のエラーになります。

```text
An error occurred (ConflictException) when calling the CreateRule operation:
Rule with action CREATE_SUBSCRIPTION_REQUEST and metadata form
MetadataFormReference(formTypeIdentifier=UsagePurposeForm, formTypeRevision=1)
already exists in domain units hierarchy in domain unit(s): 5j0d7yrs9ao0ex
```

**「アクション × 必須フォーム（type + revision）× ドメインユニット階層」の組み合わせが重複するルールは、名前が違っても作成できません**。UI で作成済みのルールがある状態で CLI から同じ内容を作ろうとするとこのエラーになるため、置き換えたいときは先に既存ルールを削除します。

```bash
aws datazone delete-rule \
  --domain-identifier "$DOMAIN_ID" \
  --identifier <RULE_ID> \
  --region "$REGION" --profile "$PROFILE"
```

内容だけ変えたい（フォームの revision 追従など）場合は `update-rule` を使うと、削除せずに同じルールIDのまま更新できます。

## フォームを更新したら、ルールの typeRevision も追従させる

`requiredMetadataForms` の `typeRevision` は作成時点の値で固定されます。フォームタイプを更新して revision が上がった場合（例: `1` → `2`）、`update-rule` で `detail` の `typeRevision` を新しい値に更新します。

## まとめ

- サブスクリプション申請時の強制も **フォームの `@required`（①）＋ 申請ルール（②）** の2段構え
- 申請ルールは `create-rule --action CREATE_SUBSCRIPTION_REQUEST` で作り、`--detail` の `metadataFormEnforcementDetail.requiredMetadataForms` に必須フォームを指定する
- 公開時ルールとの違いは **`--action` だけ**（公開は `CREATE_LISTING_CHANGE_SET`、申請は `CREATE_SUBSCRIPTION_REQUEST`）
- 選択式フィールドは **グロサリー用語集参照** で実現する（DataZone フォームは `enum` 非対応）。型は **`String` ではなく `String` の `list`**（1つだけ選択なら `@length(min:1, max:1)`）にする。`String` 型にすると申請時に `$.<Form>.<field>: array found, string expected` エラーになる
- **アクション × フォーム(type+revision) × ドメインユニットが同じルールは重複作成不可**（名前を変えてもダメ）。置き換えは `update-rule` か `delete-rule`→`create-rule`
- `list-rules` の `--target-identifier` は **domain unit ID**（ドメインIDではない）

これで、利用目的フォームの作成からサブスクリプション申請時の強制まで、AWS CLI だけで再現できます。公開時ルールと合わせて、「公開する側（personalInfoClass 必須）」と「利用する側（利用目的・利用期間必須）」の両面でメタデータ入力を統制できます。
