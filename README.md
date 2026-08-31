# swkky-qiita-articles

Qiitaの技術記事を管理するリポジトリ。

`public/` に記事を書いて `git push` するだけで Qiita に自動投稿されます。

## 仕組み

- `public/` に Qiita CLI 形式の Markdown で記事を書く
- `git push` すると GitHub Actions が以下を実行する
  1. `npm run refs` で記事間の相互参照リンク（`{{ref:...}}`）を最新のタイトル・URL に展開
  2. `qiita publish --all` で Qiita に投稿・更新

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Qiita との連携

1. [Qiita のトークン発行画面](https://qiita.com/settings/tokens/new) で `read_qiita` と `write_qiita` 権限付きのトークンを発行
2. GitHub リポジトリの Settings > Secrets and variables > Actions > **Repository secrets** に `QIITA_TOKEN` として登録

> ⚠️ Environment secrets ではなく **Repository secrets** に登録してください。

## 使い方

### 新しい記事を作成

```bash
npm run new
```

`public/` に新しい記事ファイルが生成されます。

### プレビュー（ローカル確認）

```bash
npm run preview
```

### 記事を公開

記事の front matter で `private: false` にして `git push` するだけ。

### 手動で一括投稿

```bash
npm run publish
```

## 記事間の相互参照リンク

他の記事のタイトルを引用してリンクする箇所は、タイトルを変えるたびに全記事を直すのが面倒です。
そこで **プレースホルダ記法 `{{ref:...}}`** で書き、`npm run refs` で実際のタイトル・URL に展開します。
引用先のタイトルを変えても `npm run refs` を流すだけで全箇所が自動更新されます（`git push` 時は GitHub Actions が自動実行）。

### 記法

### 記法

まず [`refs.json`](./refs.json) で引用先の記事に「参照キー」を割り当てておきます（下の「参照キーの追加」を参照）。
たとえば `smus-01-create-asset-from-glue.md` に `asset-from-glue` というキーを付けたとします。

本文では、そのキーを使って次の 2 通りの書き方ができます。

| 書き方 | 用途 | 展開後のリンクテキスト |
|---|---|---|
| `{{ref:asset-from-glue}}` | タイトルをそのまま出したいとき | 引用先の**現在のタイトル** |
| `{{ref:asset-from-glue\|前の記事}}` | 「前の記事」など文章に合わせた文言にしたいとき | `\|` の後に書いた**任意テキスト**（例では「前の記事」） |

どちらも URL（引用先の Qiita 記事）は自動で入ります。違いは**リンクの表示テキスト**だけです。

**例1: タイトルをそのままリンクにする**

本文にこう書くと…

```markdown
👉 {{ref:asset-from-glue}}
```

`npm run refs` を実行すると、こう展開されます（`[タイトル](URL)` の形）。

```markdown
👉 [SageMaker Unified Studio 「アセットってなに？」](https://qiita.com/swkky/items/092df5056ee13b7a9297)<!--ref:asset-from-glue--><!--/ref-->
```

**例2: 表示テキストを自分で決める（`|` の後に書く）**

本文にこう書くと…

```markdown
アセットの概要は {{ref:asset-from-glue|前の記事}} を参照してください。
```

`npm run refs` を実行すると、テキストは「前の記事」のまま、URL だけ入ります。

```markdown
アセットの概要は [前の記事](https://qiita.com/swkky/items/092df5056ee13b7a9297)<!--ref:asset-from-glue|前の記事--><!--/ref--> を参照してください。
```

**ポイント**

- マーカーコメント（`<!--ref:...-->`）は Qiita 上では表示されません（見えるのはリンクだけ）
- 冪等なので何度実行しても安全。引用先のタイトルを変えて再実行すると、例1のリンクテキストが自動で最新タイトルに更新されます（例2の「前の記事」のような自分で決めたテキストは変わりません）
- そもそも参照管理したくない箇所は、`{{ref:...}}` を使わず普通の Markdown リンクで書けば影響を受けません

### 参照キーの追加

参照キーと引用先記事の対応は [`refs.json`](./refs.json) で管理します。新しく引用したい記事を増やすときは、ここにキーを追加します（タイトルは対象記事の front matter から自動取得されるため、id だけ管理すれば OK）。

```json
{
  "asset-from-glue": {
    "file": "smus-01-create-asset-from-glue.md",
    "id": "092df5056ee13b7a9297"
  }
}
```

### 手動で展開

```bash
npm run refs
```

## 記事の削除

Qiita CLI はリポジトリからファイルを削除しても Qiita 上の記事は削除されません。  
[マイページ](https://qiita.com/mine)から手動で削除してください。

## ディレクトリ構成

```
.
├── .github/workflows/publish.yml  # Qiita 自動投稿用 GitHub Actions
├── public/                        # ★ 記事を書く場所（Qiita CLI 形式）
├── scripts/update-refs.mjs        # 相互参照リンク（{{ref:...}}）の展開スクリプト
├── refs.json                      # 参照キー → 記事(ファイル/id) の対応表
└── package.json
```

## 記事のフォーマット（Front Matter）

```yaml
---
title: "記事タイトル"
tags:
  - AWS
  - Terraform
private: false
updated_at: ""
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

ここから本文を書く...
```
