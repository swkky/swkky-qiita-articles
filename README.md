# swkky-qiita-articles

Qiitaの技術記事を管理するリポジトリ。

`public/` に記事を書いて `git push` するだけで Qiita に自動投稿されます。

## 仕組み

- `public/` に Qiita CLI 形式の Markdown で記事を書く
- `git push` すると GitHub Actions が `qiita publish --all` を実行して Qiita に投稿・更新

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

## 記事の削除

Qiita CLI はリポジトリからファイルを削除しても Qiita 上の記事は削除されません。  
[マイページ](https://qiita.com/mine)から手動で削除してください。

## ディレクトリ構成

```
.
├── .github/workflows/publish.yml  # Qiita 自動投稿用 GitHub Actions
├── public/                        # ★ 記事を書く場所（Qiita CLI 形式）
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
