#!/usr/bin/env node
// 記事間の相互参照リンクを冪等に展開・更新するスクリプト。
//
// 記法（本文に書く）:
//   {{ref:KEY}}            → [対象記事のタイトル](URL) に展開
//   {{ref:KEY|表示テキスト}} → [表示テキスト](URL) に展開（テキストは維持、URLだけ管理）
//
// 一度展開された参照はマーカーコメントで囲まれる:
//   <!--ref:KEY-->[タイトル](URL)<!--/ref-->
//   <!--ref:KEY|表示テキスト-->[表示テキスト](URL)<!--/ref-->
// マーカーは Qiita 上では表示されない。再実行するとマーカー内が最新のタイトル/URLで再生成される。
//
// KEY → id / タイトル取得元ファイルの対応は refs.json で定義する。

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");
const REFS_PATH = join(ROOT, "refs.json");

const QIITA_BASE = "https://qiita.com/swkky/items/";

/** front matter から title を取り出す */
function extractTitle(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = m[1];
  const titleLine = fm.match(/^title:\s*(.*)$/m);
  if (!titleLine) return null;
  let title = titleLine[1].trim();
  // クォート除去
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  return title;
}

function loadRefs() {
  const refs = JSON.parse(readFileSync(REFS_PATH, "utf8"));
  const resolved = {};
  for (const [key, def] of Object.entries(refs)) {
    const filePath = join(PUBLIC_DIR, def.file);
    const content = readFileSync(filePath, "utf8");
    const title = extractTitle(content);
    if (!title) {
      throw new Error(`title を取得できません: ${def.file} (key=${key})`);
    }
    resolved[key] = {
      id: def.id,
      title,
      url: QIITA_BASE + def.id,
    };
  }
  return resolved;
}

// 表示テキストのエスケープ（マーカーやMarkdownリンクを壊さない最小限）
function buildLink(ref, label) {
  const text = label != null && label !== "" ? label : ref.title;
  return `[${text}](${ref.url})`;
}

// KEY と 任意ラベルを表す正規表現部品
const KEY = "([A-Za-z0-9_-]+)";
const LABEL = "(?:\\|([^}>]*?))?"; // |ラベル は任意

function expand(content, refs, { file, stats }) {
  let out = content;

  // 1) 既に展開済みのマーカーを最新化: <!--ref:KEY|label-->...<!--/ref-->
  const markerRe = new RegExp(
    `<!--ref:${KEY}${LABEL}-->[\\s\\S]*?<!--/ref-->`,
    "g"
  );
  out = out.replace(markerRe, (whole, key, label) => {
    const ref = refs[key];
    if (!ref) {
      console.warn(`  [WARN] 未定義のref key: ${key} (${file}) — スキップ`);
      return whole;
    }
    stats.updated++;
    const labelPart = label != null && label !== "" ? `|${label}` : "";
    return `<!--ref:${key}${labelPart}-->${buildLink(ref, label)}<!--/ref-->`;
  });

  // 2) 未展開のプレースホルダを展開: {{ref:KEY|label}}
  const placeholderRe = new RegExp(`\\{\\{ref:${KEY}${LABEL}\\}\\}`, "g");
  out = out.replace(placeholderRe, (whole, key, label) => {
    const ref = refs[key];
    if (!ref) {
      console.warn(`  [WARN] 未定義のref key: ${key} (${file}) — スキップ`);
      return whole;
    }
    stats.expanded++;
    const labelPart = label != null && label !== "" ? `|${label}` : "";
    return `<!--ref:${key}${labelPart}-->${buildLink(ref, label)}<!--/ref-->`;
  });

  return out;
}

function main() {
  const refs = loadRefs();
  const files = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".md"));
  let changedFiles = 0;
  const totals = { expanded: 0, updated: 0 };

  for (const file of files) {
    const path = join(PUBLIC_DIR, file);
    const before = readFileSync(path, "utf8");
    const stats = { expanded: 0, updated: 0 };
    const after = expand(before, refs, { file, stats });
    if (after !== before) {
      writeFileSync(path, after, "utf8");
      changedFiles++;
      console.log(
        `  updated ${file} (展開 ${stats.expanded} / 更新 ${stats.updated})`
      );
    }
    totals.expanded += stats.expanded;
    totals.updated += stats.updated;
  }

  console.log(
    `\n完了: ${changedFiles} ファイル変更 / 新規展開 ${totals.expanded} 箇所 / 既存更新 ${totals.updated} 箇所`
  );
}

main();
