#!/usr/bin/env node
/**
 * Zenn形式のMarkdownをQiita形式に変換するスクリプト
 *
 * Usage: node scripts/convert.js <input_file> <output_file> [--repo-url <github_repo_url>]
 *
 * 変換内容:
 * - Front Matter: topics→tags, published→private, emoji/type削除
 * - 独自記法: :::message → :::note info, :::message alert → :::note alert
 * - 画像パス: /images/xxx → GitHub raw URL
 */

const fs = require("fs");
const path = require("path");

// --- 引数パース ---
const args = process.argv.slice(2);
const inputFile = args[0];
const outputFile = args[1];
const repoUrlIdx = args.indexOf("--repo-url");
const repoUrl = repoUrlIdx !== -1 ? args[repoUrlIdx + 1] : null;

if (!inputFile || !outputFile) {
  console.error("Usage: node scripts/convert.js <input> <output> [--repo-url <url>]");
  process.exit(1);
}

const content = fs.readFileSync(inputFile, "utf-8");

// --- Front Matter の分離 ---
const fmRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const match = content.match(fmRegex);

if (!match) {
  console.error("Front matter not found in:", inputFile);
  process.exit(1);
}

const frontMatter = match[1];
const body = match[2];

// --- Front Matter の変換 ---
function convertFrontMatter(fm, outputFilePath) {
  const lines = fm.split("\n");
  const result = {};

  for (const line of lines) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      result[key] = value;
    }
  }

  // Qiita形式のfront matterを構築
  const qiitaFm = [];
  qiitaFm.push(`title: ${result.title || '""'}`);

  // topics → tags
  if (result.topics) {
    const topics = JSON.parse(result.topics.replace(/'/g, '"'));
    qiitaFm.push("tags:");
    for (const topic of topics) {
      qiitaFm.push(`  - ${topic}`);
    }
  }

  // published → private (反転)
  const published = result.published === "true";
  qiitaFm.push(`private: ${!published}`);

  // 既存のQiitaファイルからidとupdated_atを引き継ぐ
  let existingId = "null";
  let updatedAt = "''";
  if (fs.existsSync(outputFilePath)) {
    const existing = fs.readFileSync(outputFilePath, "utf-8");
    const idMatch = existing.match(/^id:\s*(.+)$/m);
    const updatedMatch = existing.match(/^updated_at:\s*(.+)$/m);
    if (idMatch) existingId = idMatch[1].trim();
    if (updatedMatch) updatedAt = updatedMatch[1].trim();
  }

  qiitaFm.push(`updated_at: ${updatedAt}`);
  qiitaFm.push(`id: ${existingId}`);
  qiitaFm.push("organization_url_name: null");
  qiitaFm.push("slide: false");
  qiitaFm.push("ignorePublish: false");

  return qiitaFm.join("\n");
}

// --- 本文の変換 ---
function convertBody(bodyText) {
  let converted = bodyText;

  // :::message alert → :::note alert
  converted = converted.replace(/^:::message alert$/gm, ":::note alert");

  // :::message → :::note info
  converted = converted.replace(/^:::message$/gm, ":::note info");

  // 画像パスの変換（/images/ → GitHub raw URL）
  if (repoUrl) {
    // https://github.com/user/repo → https://raw.githubusercontent.com/user/repo/main
    const rawUrl = repoUrl
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      + "/main";
    converted = converted.replace(
      /!\[([^\]]*)\]\(\/images\/([^)]+)\)/g,
      `![$1](${rawUrl}/images/$2)`
    );
  }

  return converted;
}

// --- 変換実行 ---
const qiitaFrontMatter = convertFrontMatter(frontMatter, outputFile);
const qiitaBody = convertBody(body);
const output = `---\n${qiitaFrontMatter}\n---\n${qiitaBody}`;

// 出力ディレクトリがなければ作成
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, output, "utf-8");
console.log(`✅ Converted: ${inputFile} → ${outputFile}`);
