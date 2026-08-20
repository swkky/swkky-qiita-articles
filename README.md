# zenn-qiita-articles

ZennとQiitaの技術記事を1つのリポジトリで一括管理するテンプレートです。

1つのMarkdownを書いて `git push` するだけで、ZennとQiita両方に自動投稿されます。

## 仕組み

- `articles/` にZenn形式のMarkdownで記事を書く
- `git push` すると GitHub Actions が自動で Qiita 形式に変換して投稿
- Zenn側はGitHub連携で自動反映

変換には [zenn-qiita-sync](https://github.com/C-Naoki/zenn-qiita-sync) を使用しています。

## セットアップ

### 1. このリポジトリをテンプレートとして使う

このリポジトリをforkまたはcloneして、自分のPrivateリポジトリとして作成してください。

> 💡 HTTPS経由でpushする場合、Personal Access Token（PAT）に `repo` と `workflow` スコープが必要です。`workflow` がないと `.github/workflows/` 配下のファイルをpushできません。

### 2. 依存関係のインストール

```bash
npm install
```

### 3. Zenn との連携

[Zenn のダッシュボード](https://zenn.dev/dashboard/deploys) からリポジトリを連携する。

### 4. Qiita との連携

1. [Qiita のトークン発行画面](https://qiita.com/settings/tokens/new) で `read_qiita` と `write_qiita` 権限付きのトークンを発行
2. GitHub リポジトリの Settings > Secrets and variables > Actions > **Repository secrets** に `QIITA_TOKEN` として登録

> ⚠️ Environment secrets ではなく **Repository secrets** に登録してください。

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

GitHub Actions が Qiita 形式のファイルを自動生成してコミットするため、次回 push 前に pull が必要になります。以下のエイリアスを設定しておくと便利です：

```bash
git config --local alias.pp '!git pull --rebase && git push'
```

以降は `git pp` で pull & push を一度に実行できます。

## 記事の非公開・削除

### 非公開にしたい場合

| プラットフォーム | 方法 |
|---|---|
| Zenn | front matter で `published: false` にして `git push` すれば非公開になる |
| Qiita | **CLI/API経由では非公開にできない**。[Qiita のマイページ](https://qiita.com/mine)から手動で限定公開 or 削除する |

### 削除したい場合

| プラットフォーム | 方法 |
|---|---|
| Zenn | `articles/` からファイルを削除して `git push` すれば非公開になる |
| Qiita | GitHub からの削除では消えない。[Qiita のマイページ](https://qiita.com/mine)から手動で削除する |

> ⚠️ Qiita は一度公開した記事を API 経由で非公開・削除できません。公開前に `published: false` の状態でプレビュー確認してから公開することをおすすめします。

## ディレクトリ構成

```
.
├── .github/workflows/publish.yml  # Qiita自動投稿用のGitHub Actions
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

## 技術スタック

- [Zenn CLI](https://zenn.dev/zenn/articles/install-zenn-cli) - 記事の作成・プレビュー
- [zenn-qiita-sync](https://github.com/C-Naoki/zenn-qiita-sync) - Zenn形式 → Qiita形式の自動変換・投稿
- GitHub Actions - 自動化

## GitHub Actionsの料金

- **Publicリポジトリ**: 完全無料
- **Privateリポジトリ**: 月2,000分まで無料（Freeプラン）

記事pushの1回あたり数十秒程度なので、Privateリポジトリで運用しても無料枠を超えることはまずありません。

## ライセンス

MIT
