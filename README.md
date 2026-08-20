# zenn-qiita-articles

ZennとQiitaの技術記事を1つのリポジトリで一括管理するテンプレートです。

1つのMarkdownを書いて `git push` するだけで、ZennとQiita両方に自動投稿されます。外部Actionへの依存なしで、記事の非公開化・削除にも対応しています。

## 仕組み

- `articles/` にZenn形式のMarkdownで記事を書く
- `git push` すると GitHub Actions が自前スクリプトでQiita形式に変換して投稿
- Zenn側はGitHub連携で自動反映

## 特徴

- ✅ 外部Actionへの依存なし（自前の変換スクリプト）
- ✅ `published: false` → Qiita上で自動的に限定公開化
- ✅ 記事ファイルを削除 → Qiita上で自動的に記事を削除
- ✅ Zenn独自記法をQiita記法に自動変換
- ✅ 画像パスをGitHub raw URLに自動変換

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
| Zenn | front matter で `published: false` にして `git push` |
| Qiita | 同上。ワークフローが自動で Qiita API を呼び出し、限定公開に変更する |

### 削除したい場合

| プラットフォーム | 方法 |
|---|---|
| Zenn | `articles/` からファイルを削除して `git push` |
| Qiita | 同上。ワークフローが自動で Qiita API を呼び出し、記事を削除する |

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

## GitHub Actionsの料金

- **Publicリポジトリ**: 完全無料
- **Privateリポジトリ**: 月2,000分まで無料（Freeプラン）

## ライセンス

MIT
