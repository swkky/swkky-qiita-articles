---
title: SageMaker Unified Studio でアセット公開時に必須メタデータを強制するルールを AWS CLI で作成する
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

SageMaker Unified Studio（DataZone V2）では、メタデータフォームのフィールドを `@required` で必須にできます。ただしこれは「**そのフォームをアセットに添付したときに必須になる**」だけで、フォーム自体を添付しなければ素通りしてしまいます。

「アセットをカタログに公開する時点で、必ずこのフォーム（＝必須項目）を入力させる」を実現するには、**ドメインユニットに公開時メタデータ強制ルール（Metadata enforcement rule for publishing）** を作成します。

本記事では、AWS CLI（`aws datazone create-rule`）でこのルールを作成する方法を、実際に実行して確認したコマンドで解説します。あわせて、検証中にハマった **重複制約** や **`list-rules` の指定方法** といった実務的な注意点もまとめます。

前提となるメタデータフォームの作り方（必須フィールド・グロサリー紐付け）は、先にこちらを参照してください。

- [SageMaker Unified Studio でグロサリー紐付き必須フィールドを持つメタデータフォームを AWS CLI で作成する](https://qiita.com/swkky/items/xxxxxxxxxxxx)（※公開後にリンク差し替え）

:::note
本記事のコマンドは実環境（`ap-northeast-1`）で実行して動作確認しています。UI の細部や仕様は変わる可能性があります。
:::

## 「必須フィールド」と「公開時の強制」は別物

まず全体像を整理します。「公開時に必ずある項目を埋めさせる」には、次の**2段構え**が必要です。

| レイヤー | 仕組み | 効果 |
|---|---|---|
| ① フォーム定義 | フィールドに `@required` | フォームを添付したときに、その項目を必須にする |
| ② 公開ルール | `create-rule`（`METADATA_FORM_ENFORCEMENT`） | アセット/データプロダクト公開時に、そのフォームの添付を必須にする |

- ①だけ → フォームを添付しなければ素通り
- ②だけ → フォームは添付必須だが、中身が空でも通りうる（フィールドが `@required` でなければ）
- **①＋② → 公開時に必ずその項目が埋まる**

本記事は②を扱います。①は前掲の記事を参照してください。

## 前提

- AWS CLI v2 がインストール・設定済みであること
- 対象フォームタイプが作成済みであること（本記事では `DLHDataAttributes` を例にします）
- ルールを作成する権限があること（ドメインユニットのオーナー相当）

:::note warn
対象フォームにグロサリー用語集を紐付けたフィールド（`@amazon.datazone#glossaryterm(...)`）がある場合、そのフィールドの型は **`String` ではなく「`String` の `list`」**（1つだけ選択なら `@length(min:1, max:1)`）で定義しておく必要があります。`String` 型のまま公開ルールで必須化すると、アセット公開時（`CREATE_LISTING_CHANGE_SET`）に `$.<Form>.<field>: array found, string expected`（配列が来たが文字列を期待）というエラーになり、公開できません。フォーム定義の作り方は前掲のフォーム作成記事を参照してください。
:::

変数:

```bash
DOMAIN_ID=dzd-xxxxxxxxxxxxxx        # DataZone / SMUS ドメインID
REGION=ap-northeast-1
PROFILE=your-profile
```

## STEP 1: ターゲットとなるドメインユニットIDを確認する

ルールはドメインユニットに紐付きます。ドメイン全体に効かせたい場合は **ルートドメインユニット** を対象にします。ルートドメインユニットIDは `get-domain` の `rootDomainUnitId` で取得できます。

```bash
aws datazone get-domain \
  --identifier "$DOMAIN_ID" \
  --region "$REGION" --profile "$PROFILE" \
  --query 'rootDomainUnitId' --output text
```

```bash
DOMAIN_UNIT_ID=5j0d7yrs9ao0ex   # ↑で取得した rootDomainUnitId
```

## STEP 2: 公開時メタデータ強制ルールを作成する

`create-rule` で作成します。ポイントは以下です。

- `--action CREATE_LISTING_CHANGE_SET` … 「アセット/データプロダクトの公開」に効くルール（サブスク申請に効かせるなら `CREATE_SUBSCRIPTION_REQUEST`）
- `--detail` に `metadataFormEnforcementDetail.requiredMetadataForms` を渡す … 必須にするフォームを **`typeIdentifier` + `typeRevision`** で指定（最大5つ）
- `--scope` … 対象のアセット型・データプロダクト・プロジェクトを絞る
- `--target` … 対象ドメインユニット。`includeChildDomainUnits: true` で子ユニットにも継承

```bash
aws datazone create-rule \
  --domain-identifier "$DOMAIN_ID" \
  --name Publish-Require-PersonalInfoClass \
  --action CREATE_LISTING_CHANGE_SET \
  --scope '{
    "assetType": {
      "selectionMode": "SPECIFIC",
      "specificAssetTypes": [
        "amazon.datazone.GlueTableAssetType",
        "amazon.datazone.GlueViewAssetType",
        "amazon.datazone.RedshiftViewAssetType",
        "amazon.datazone.RedshiftTableAssetType"
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
        { "typeIdentifier": "DLHDataAttributes", "typeRevision": "6" }
      ]
    }
  }' \
  --region "$REGION" --profile "$PROFILE"
```

レスポンス例:

```json
{
    "identifier": "3tnkwpk54w4eu1",
    "name": "Publish-Require-PersonalInfoClass",
    "ruleType": "METADATA_FORM_ENFORCEMENT",
    "action": "CREATE_LISTING_CHANGE_SET",
    "target": {
        "domainUnitTarget": { "domainUnitId": "5j0d7yrs9ao0ex", "includeChildDomainUnits": true }
    },
    "scope": {
        "assetType": {
            "selectionMode": "SPECIFIC",
            "specificAssetTypes": [
                "amazon.datazone.GlueTableAssetType",
                "amazon.datazone.GlueViewAssetType",
                "amazon.datazone.RedshiftViewAssetType",
                "amazon.datazone.RedshiftTableAssetType"
            ]
        },
        "dataProduct": true,
        "project": { "selectionMode": "ALL" }
    },
    "detail": {
        "metadataFormEnforcementDetail": {
            "requiredMetadataForms": [
                { "typeIdentifier": "DLHDataAttributes", "typeRevision": "6" }
            ]
        }
    },
    "targetType": "DOMAIN_UNIT"
}
```

:::note info
`create-rule` に `ruleType` パラメータはありません。`--detail` に `metadataFormEnforcementDetail` を渡すと、`ruleType` は自動的に `METADATA_FORM_ENFORCEMENT` になります（レスポンスで確認できます）。
:::

### `--scope` の選択肢

- `assetType.selectionMode`: `ALL`（全アセット型）または `SPECIFIC`（`specificAssetTypes` で列挙）。UI から作ると Glue/Redshift のテーブル・ビューに絞られた状態になります。
- `dataProduct`: データプロダクトも対象にするか（`true`/`false`）。
- `project.selectionMode`: `ALL` または `SPECIFIC`（`specificProjects` で列挙）。

## STEP 3: 作成したルールを確認する

一覧は `list-rules` で確認します。

```bash
aws datazone list-rules \
  --domain-identifier "$DOMAIN_ID" \
  --target-type DOMAIN_UNIT \
  --target-identifier "$DOMAIN_UNIT_ID" \
  --action CREATE_LISTING_CHANGE_SET \
  --region "$REGION" --profile "$PROFILE"
```

個別の詳細（`detail` 含む）は `get-rule`:

```bash
aws datazone get-rule \
  --domain-identifier "$DOMAIN_ID" \
  --identifier 3tnkwpk54w4eu1 \
  --region "$REGION" --profile "$PROFILE"
```

:::note warn
`list-rules` の `--target-identifier` には **ドメインID ではなく domain unit ID** を渡します。ここにドメインID（`dzd-...`）を渡すと `AccessDeniedException`（ListRules 不可）になります。ルールの対象はあくまでドメインユニットである点に注意してください。
:::

## ハマりどころ: 同一内容のルールは名前を変えても作れない

検証中、既に同じ内容のルールが存在する状態で、名前だけ変えて `create-rule` したところ次のエラーになりました。

```text
An error occurred (ConflictException) when calling the CreateRule operation:
Rule with action CREATE_LISTING_CHANGE_SET and metadata form
MetadataFormReference(formTypeIdentifier=DLHDataAttributes, formTypeRevision=6)
already exists in domain units hierarchy in domain unit(s): 5j0d7yrs9ao0ex
```

つまり、**「アクション × 必須フォーム（type + revision）× ドメインユニット階層」の組み合わせが重複するルールは、名前が違っても作成できません**。同じ強制を二重に定義できないようになっています。

既存ルールを置き換えたい場合は、次のどちらかを使います。

- 内容を変えるだけなら **`update-rule`**（同じルールIDに対して更新）
- いったん消して作り直すなら **`delete-rule` → `create-rule`**

```bash
# 既存ルールを削除
aws datazone delete-rule \
  --domain-identifier "$DOMAIN_ID" \
  --identifier <RULE_ID> \
  --region "$REGION" --profile "$PROFILE"
```

## フォームを更新したら、ルールの typeRevision も追従させる

`requiredMetadataForms` の `typeRevision` は作成時点の値で固定されます。フォームタイプを更新して revision が上がった場合（例: `6` → `7`）、ルールが古い revision を参照したままになるため、`update-rule` で `detail` の `typeRevision` を新しい値に更新します。

たとえばグロサリー紐付けフィールドの型を `String` から `list` に修正してフォームの revision が `6` → `7` に上がったら、次のようにルールを追従させます。

```bash
aws datazone update-rule \
  --domain-identifier "$DOMAIN_ID" \
  --identifier <RULE_ID> \
  --detail '{
    "metadataFormEnforcementDetail": {
      "requiredMetadataForms": [
        { "typeIdentifier": "DLHDataAttributes", "typeRevision": "7" }
      ]
    }
  }' \
  --region "$REGION" --profile "$PROFILE"
```

`update-rule` はルールIDを保ったまま更新でき、`scope` などの他の設定は維持されます（`detail` を渡すと必須フォームの指定のみ差し替わります）。

## まとめ

- 「公開時に必ず入力させる」は **フォームの `@required`（①）＋ 公開ルール（②）** の2段構え
- 公開ルールは `create-rule --action CREATE_LISTING_CHANGE_SET` で作り、`--detail` の `metadataFormEnforcementDetail.requiredMetadataForms` に必須フォームを指定する
- `ruleType` は指定不要（`detail` から自動決定）
- **アクション × フォーム(type+revision) × ドメインユニットが同じルールは重複作成不可**（名前を変えてもダメ）。置き換えは `update-rule` か `delete-rule`→`create-rule`
- `list-rules` の `--target-identifier` は **domain unit ID**（ドメインIDではない）
- フォーム更新で revision が上がったら、ルールの `typeRevision` も追従させる

これで、フォーム定義から公開時の強制まで、データガバナンスの必須メタデータ運用を AWS CLI だけで再現できます。
