---
title: SageMaker Unified Studio でグロサリー用語集に紐づいた必須フィールドを持つメタデータフォームを作成する
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

SageMaker Unified Studio（DataZone V2）のメタデータフォームでは、フィールドを **グロサリー用語集（統制語彙）に紐付け**たり、**必須フィールド**にしたりできます。これにより「この項目は決められた選択肢から必ず1つ選ぶ」というガバナンスを、フォーム定義そのものに埋め込めます。

本記事では、AWS CLI（`aws datazone`）だけを使って、

- グロサリー用語集と用語（選択肢）を作成し
- 複数フィールドを持つメタデータフォームを作成し
- そのうち1フィールドを **グロサリー紐付け＋必須** にする

という一連の手順を、実際に実行できるコマンドで解説します。

グロサリーやメタデータフォームの概念については、先に以下の記事を読むと理解が深まります。

- [SageMaker Unified Studio のグロサリー(ビジネス用語集)を AWS CLI で作成する](https://qiita.com/swkky/items/8259ea1f71ab6c8d6be5)
- [【データガバナンス入門】SageMaker Unified Studio のメタデータフォームを具体例で理解する](https://qiita.com/swkky/items/xxxxxxxxxxxx)（※公開後にリンク差し替え）

:::note
本記事のコマンドは実環境（`ap-northeast-1`）で実行して動作確認しています。ただし UI の細部や仕様は変わる可能性があります。
:::

## 何を作るか

「データ管理フォーム」を例にします。次の5フィールドを持ち、`confidentiality`（機密区分）だけを **グロサリー紐付け＋必須** にします。

| フィールド | 型 | 必須 | グロサリー紐付け |
|---|---|---|---|
| `systemName` | String | - | - |
| `dataOwner` | String | - | - |
| `updateFrequency` | String | - | - |
| `confidentiality` | String の list（要素数1） | ✅ | ✅ 機密区分用語集 |
| `note` | String | - | - |

`confidentiality` の選択肢（統制語彙）は、グロサリー用語集に `公開` / `社外秘` / `極秘` の3語を登録して表現します。

## 前提

- AWS CLI v2 がインストール・設定済みであること
- SageMaker Unified Studio（DataZone V2）のドメインとプロジェクトが作成済みであること
- フォーム／グロサリーを作成する権限があること

以降のコマンドでは、次の変数を使います。ご自身の環境に合わせて置き換えてください。

```bash
DOMAIN_ID=dzd-xxxxxxxxxxxxxx        # DataZone / SMUS ドメインID
PROJECT_ID=xxxxxxxxxxxxxx           # フォーム・グロサリーを所有するプロジェクトID
REGION=ap-northeast-1
PROFILE=your-profile                # 適宜変更（未設定なら --profile を外す）
```

## ポイント: Smithy トレイトで型・必須・グロサリー紐付けを表現する

メタデータフォームの定義は **Smithy** というモデリング言語の `structure` で記述し、`--model` パラメータに JSON（`smithy` メンバー）として渡します。フィールドの性質は「トレイト（`@...`）」で表現します。

| やりたいこと | トレイト |
|---|---|
| 必須フィールドにする | `@required` |
| グロサリー用語集に紐付ける（統制語彙化） | `@amazon.datazone#glossaryterm("<グロサリーID>")` |
| 検索インデックス対象にする | `@amazon.datazone#searchable` |

**`@required` と `@amazon.datazone#glossaryterm(...)` は同じフィールドに併記できます。** これが今回の肝です。

```smithy
@length(min:1, max:1)
list ConfidentialityList {member: String}
structure ArticleSampleForm {
  systemName: String,
  dataOwner: String,
  updateFrequency: String,
  @amazon.datazone#glossaryterm("<グロサリーID>")
  @required
  confidentiality: ConfidentialityList,
  note: String
}
```

:::note warn
**グロサリー紐付けフィールドの型は `String` ではなく「`String` の `list`（配列）」にします。** 用語を1つだけ選ばせたい場合でも、`@length(min:1, max:1)` の制約を付けた `list` 型で定義するのが正しい仕様です。

UI からグロサリー紐付けフィールドを作成すると、内部的には必ずこの `list` 型（`@length(min:1, max:1) list ... {member: String}`）で生成されます。ここを `String` 型で定義すると、サブスクリプション申請時や公開時の enforcement で `$.<Form>.<field>: array found, string expected`（配列が来たが文字列を期待）というエラーになり、リクエストが完了できません。

値は内部的にグロサリー用語のID（の配列）で格納され、UI ではそのグロサリーの用語からの選択式（ドロップダウン）になります。Search / SearchListings API でフィルタ条件としても使えます。
:::

## STEP 1: グロサリー用語集を作成する

まず、選択肢（統制語彙）を入れる器となるグロサリー用語集を作ります。

```bash
aws datazone create-glossary \
  --domain-identifier "$DOMAIN_ID" \
  --owning-project-identifier "$PROJECT_ID" \
  --name "データ機密区分" \
  --description "データの機密区分を表す統制語彙" \
  --status ENABLED \
  --region "$REGION" --profile "$PROFILE"
```

レスポンス例:

```json
{
    "domainId": "dzd-xxxxxxxxxxxxxx",
    "id": "c6u18mhfw0bb89",
    "name": "データ機密区分",
    "owningProjectId": "xxxxxxxxxxxxxx",
    "description": "データの機密区分を表す統制語彙",
    "status": "ENABLED"
}
```

返ってきた `id` を、フォームから参照するために控えます。

```bash
GLOSSARY_ID=c6u18mhfw0bb89   # ↑のレスポンスの id
```

## STEP 2: 用語（選択肢）を追加する

`公開` / `社外秘` / `極秘` の3語を追加します。ループでまとめて作れます。

```bash
for TERM in "公開" "社外秘" "極秘"; do
  aws datazone create-glossary-term \
    --domain-identifier "$DOMAIN_ID" \
    --glossary-identifier "$GLOSSARY_ID" \
    --name "$TERM" \
    --status ENABLED \
    --region "$REGION" --profile "$PROFILE"
done
```

レスポンス例（1件分）:

```json
{
    "id": "bwumf33jbm7vo9",
    "domainId": "dzd-xxxxxxxxxxxxxx",
    "glossaryId": "c6u18mhfw0bb89",
    "name": "公開",
    "status": "ENABLED"
}
```

:::note info
用語には `--short-description` で説明を付けられます（判定基準を書いておくと運用時に迷いません）。
:::

## STEP 3: メタデータフォームを作成する（1フィールドをグロサリー紐付け＋必須）

いよいよフォーム本体です。`--model` に Smithy 定義を渡します。

```bash
aws datazone create-form-type \
  --domain-identifier "$DOMAIN_ID" \
  --owning-project-identifier "$PROJECT_ID" \
  --name "ArticleSampleForm" \
  --status ENABLED \
  --model "$(cat <<EOF
{"smithy": "@length(min:1, max:1)\nlist ConfidentialityList {member: String}\nstructure ArticleSampleForm {\nsystemName: String,\ndataOwner: String,\nupdateFrequency: String,\n@amazon.datazone#glossaryterm(\"$GLOSSARY_ID\")\n@required\nconfidentiality: ConfidentialityList,\nnote: String\n}"}
EOF
)" \
  --region "$REGION" --profile "$PROFILE"
```

レスポンス例:

```json
{
    "domainId": "dzd-xxxxxxxxxxxxxx",
    "name": "ArticleSampleForm",
    "revision": "1"
}
```

`revision: "1"` が返れば作成成功です。

### `--model` の書き方の注意

`--model` は JSON の Union 型で、`smithy` メンバーに定義文字列を入れます。文字列内では次のエスケープが必要です。

- 改行 → `\n`
- `glossaryterm("...")` のダブルクォート → `\"`（ヒアドキュメント内ではさらに `\\"` ではなく `\"` でOK）

エスケープが煩雑なので、上記のように **ヒアドキュメント（`<<EOF`）** で組み立てると読みやすくなります。1行の JSON をそのまま渡すこともできます。

```bash
--model '{"smithy": "@length(min:1, max:1)\nlist ConfidentialityList {member: String}\nstructure ArticleSampleForm {\nsystemName: String,\ndataOwner: String,\nupdateFrequency: String,\n@amazon.datazone#glossaryterm(\"c6u18mhfw0bb89\")\n@required\nconfidentiality: ConfidentialityList,\nnote: String\n}"}'
```

:::note warn
`namespace dzd_xxx` を先頭に付ける公式サンプルもありますが、無しでも作成できます（本記事は namespace 無しで動作確認済み）。既存フォームを更新する場合は、元の定義の書式（namespace の有無）に揃えておくと安全です。
:::

## STEP 4: 作成結果を確認する

```bash
aws datazone get-form-type \
  --domain-identifier "$DOMAIN_ID" \
  --form-type-identifier "ArticleSampleForm" \
  --region "$REGION" --profile "$PROFILE"
```

レスポンス例:

```json
{
    "domainId": "dzd-xxxxxxxxxxxxxx",
    "name": "ArticleSampleForm",
    "revision": "1",
    "model": {
        "smithy": "@length(min:1, max:1)\nlist ConfidentialityList {member: String}\nstructure ArticleSampleForm {\nsystemName: String,\ndataOwner: String,\nupdateFrequency: String,\n@amazon.datazone#glossaryterm(\"c6u18mhfw0bb89\")\n@required\nconfidentiality: ConfidentialityList,\nnote: String\n}"
    },
    "owningProjectId": "xxxxxxxxxxxxxx",
    "status": "ENABLED",
    "imports": []
}
```

`model.smithy` に `@amazon.datazone#glossaryterm(...)` と `@required` が含まれていれば、`confidentiality` が「グロサリー紐付き必須フィールド」になっています。UI 上ではこのフォームをアセットに追加すると、`confidentiality` が用語集からの選択式かつ必須入力になります。

## 補足: フィールドで使えるデータ型

Smithy の `structure` フィールドでは、次の型が使えます。

- `String`
- `Boolean`
- `Integer`
- `Double`（Decimal 相当）
- `Date`
- `list`（`String` の配列。グロサリー紐付けフィールドで使用）

**グロサリー紐付けフィールドは `String` ではなく、`String` を要素とする `list` 型にして `@amazon.datazone#glossaryterm(...)` を付けます。** 用語を1つだけ選ばせたい場合は `@length(min:1, max:1)` を、複数選択させたい場合は `@length` の上限を増やすか外します。

```smithy
@length(min:1, max:1)              // 1つだけ選択
list ConfidentialityList {member: String}
```

## 補足: フォームの「更新」は新リビジョン作成

既存フォームを変更したいときは、**同じ `--name`・同じ owning project で再度 `create-form-type` を実行**します。これで `revision` が `2`, `3`... と増えていきます（旧リビジョンは残ります）。たとえば「あるフィールドを後から必須にする」場合は、`@required` を足した定義で作り直すだけです。

## 補足: 「必須」の効き方と、公開時の強制について

`@required` は **そのフォームをアセットに添付したときに、当該フィールドを必須にする** ものです。「フォーム自体の添付」をアセット公開時に強制したい場合は、別途 **ドメインユニットに公開時メタデータ強制ルール**（`aws datazone create-rule`、`ruleType=METADATA_FORM_ENFORCEMENT` / `action=CREATE_LISTING_CHANGE_SET`）を作成し、必須フォームとして指定します。

つまり「公開時に必ずこの項目を埋めさせる」を完全に実現するには、

1. フォーム側で対象フィールドを `@required` にする（本記事）
2. 公開ルールで当該フォームの添付を必須にする

の2段構えになります。ルール側の指定はフォーム単位（`typeIdentifier` + `typeRevision`）なので、フォームを更新して revision が上がったらルール側の `typeRevision` も追従させます。

## 後片付け（任意）

検証用に作ったフォーム・グロサリーを削除する場合は次のとおりです。フォームタイプ → 用語 → グロサリーの順に消します。

```bash
# フォームタイプ削除
aws datazone delete-form-type \
  --domain-identifier "$DOMAIN_ID" \
  --form-type-identifier ArticleSampleForm \
  --region "$REGION" --profile "$PROFILE"

# 用語削除（TERM_ID は create-glossary-term のレスポンス id）
aws datazone delete-glossary-term \
  --domain-identifier "$DOMAIN_ID" \
  --identifier <TERM_ID> \
  --region "$REGION" --profile "$PROFILE"

# グロサリー削除
aws datazone delete-glossary \
  --domain-identifier "$DOMAIN_ID" \
  --identifier "$GLOSSARY_ID" \
  --region "$REGION" --profile "$PROFILE"
```

## まとめ

- メタデータフォームのフィールドは Smithy トレイトで性質を表現する
- `@required` で必須化、`@amazon.datazone#glossaryterm("<ID>")` でグロサリー紐付け（統制語彙化）でき、**両者は併記可能**
- グロサリー紐付けフィールドは **`String` の `list` 型**（1つだけ選択なら `@length(min:1, max:1)`）にし、選択肢は用語集の用語として登録する（`String` 型で定義すると enforcement 時に `array found, string expected` エラーになる）
- フォームの更新は同名 `create-form-type` による新リビジョン作成
- 「公開時に必ず入力させる」には、フォームの `@required` に加えて公開時メタデータ強制ルール（`create-rule`）を併用する

AWS CLI だけで、統制語彙に基づく必須メタデータをコードで再現可能な形で定義できます。IaC やスクリプトに組み込めば、フォーム定義のレビュー・バージョン管理もしやすくなります。
