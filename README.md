# swkky-zenn-qiita-articles

ZennとQiitaの技術記事を1つのリポジトリで一括管理するリポジトリ。

1つのMarkdownを書いて `git push` するだけで、ZennとQiita両方に自動投稿されます。

## 仕組み

- `articles/` にZenn形式のMarkdownで記事を書く
- `git push` すると GitHub Actions が自前スクリプトでQiita形式に変換して投稿
- Zenn側はGitHub連携で自動反映

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Zenn との連携

[Zenn のダッシュボード](https://zenn.dev/dashboard/deploys) からこのリポジトリを連携する。

### 3. Qiita との連携

1. [Qiita のトークン発行画面](https://qiita.com/settings/tokens/new) で `read_qiita` と `write_qiita` 権限付きのトークンを発行
2. GitHub リポジトリの Settings > Secrets and variables > Actions > **Repository secrets** に `QIITA_TOKEN` として登録

## 使い方

### 新しい記事を作成

```bash
npm run new -- --slug my-article-slug --title "記事タイトル"
```

### プレビュー（ローカル確認）

```bash
npm run preview
```

ブラウザが自動で開き、Zenn形式のプレビューが確認できます。

### 記事を公開

記事の front matter で `published: true` にして `git push` するだけ。

### push時の注意

GitHub Actions が Qiita 形式のファイルを自動生成してコミットするため、次回 push 前に pull が必要になります。

```bash
git pull --rebase && git push'
```

## 記事の非公開・削除

### 非公開にしたい場合

1. front matter を `published: false` にして `git push`
2. **Zenn** → 自動で非公開になる
3. **Qiita** → 変化なし（公開後の非公開化はQiitaの仕様で不可）。[マイページ](https://qiita.com/mine)から手動で削除してください

### 削除したい場合

1. **Zenn** → [ダッシュボード](https://zenn.dev/dashboard)から手動で削除。その後リポジトリからもファイルを削除してpush（ファイルが残っていると次回デプロイで復活する）
2. **Qiita** → リポジトリからファイルを削除して `git push` すれば自動で削除される

### プラットフォームの制約

- **Qiita**: 一度全体公開した記事を限定共有（非公開）に戻すことはできません（[公式ヘルプ](https://help.qiita.com/ja/articles/qiita-post)）
- **Zenn**: GitHub連携でリポジトリからファイルを削除しても記事は削除されません。削除はダッシュボードからのみ可能です（[公式ドキュメント](https://zenn.dev/zenn/articles/connect-to-github#コンテンツの削除)）

## ディレクトリ構成

```
.
├── .github/workflows/publish.yml  # 自動変換・投稿ワークフロー
├── scripts/convert.js             # Zenn → Qiita 変換スクリプト
├── articles/                      # ★ 記事を書く場所（Zenn形式Markdown）
├── books/                         # Zennの本（任意）
├── images/                        # 記事で使う画像
├── qiita/public/                  # 自動生成（Qiita形式、手動編集不要）
└── package.json
```

## 記事のフォーマット（Front Matter）

```yaml
---
title: "記事タイトル"
emoji: "🐙"
type: "tech"  # tech or idea
topics: ["GitHub", "Zenn", "Qiita"]
published: true  # trueにするとZenn・Qiita両方に公開
---

ここから本文を書く...
```

## 変換される記法

| Zenn | Qiita |
|---|---|
| `:::message` | `:::note info` |
| `:::message alert` | `:::note alert` |
| `/images/xxx.png` | GitHub raw URL |
| `topics: [...]` | `tags:\n  - ...` |
| `published: true` | `private: false` |
