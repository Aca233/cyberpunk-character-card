/**
 * 写正文这一步的提示词里戏和机制各占多少（用户 2026-10-31："越来越像游戏而不是角色扮演了"，同意先统计："可以"）：
 * 挑 data/saves 里回合最多的存档（或命令行给的存档 id），照 situation-baseline 从初始世界重放到最后，
 * 按当前状态拼一轮「看看四周」的 ③ 写正文，按【】标题切块、粗估 token。只读存档，不调用模型。
 *
 *   pnpm --filter @cp/tools exec tsx prompt-share.ts [存档 id]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gameContent, gameData, openingPremise } from "@cp/content";
import {
  buildNarratorPrompt,
  effectiveTurns,
  newGameWorld,
  parseLog,
  replay,
  SaveMetaSchema,
  TurnInputSchema,
} from "@cp/core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVES = join(ROOT, "data", "saves");

/** 同 core 的 estimateTokens：汉字和全角标点按 1 个算，其余每 4 个字符算 1 个 */
function tokens(text: string): number {
  let han = 0;
  let other = 0;
  for (const ch of text) {
    if (/[㐀-鿿　-〿＀-￯]/.test(ch)) han += 1;
    else other += 1;
  }
  return han + Math.ceil(other / 4);
}

function load(id: string) {
  const dir = join(SAVES, id);
  const meta = SaveMetaSchema.parse(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")));
  const { records } = parseLog(readFileSync(join(dir, "turns.jsonl"), "utf8"));
  return { meta, records };
}

const ids = readdirSync(SAVES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("s-"))
  .map((e) => e.name)
  .sort();

let pick = process.argv[2];
if (pick === undefined) {
  let most = -1;
  for (const id of ids) {
    try {
      const n = effectiveTurns(load(id).records).length;
      if (n > most) {
        most = n;
        pick = id;
      }
    } catch {
      // 读不了的存档跳过
    }
  }
}
if (pick === undefined) throw new Error("data/saves 里没有能读的存档");

const { meta, records } = load(pick);
const world = replay({ nextSeq: 0, world: newGameWorld(meta, gameContent) }, records);
const prompt = buildNarratorPrompt(
  world,
  records,
  { kind: "action", input: TurnInputSchema.parse({ text: "看看四周" }) },
  { data: gameData, opening: openingPremise(meta.opening), startTime: meta.startTime },
);

const rows: { where: string; title: string; tokens: number }[] = [];
let history = 0;
let state = "";
const last = prompt.messages.length - 1;
prompt.messages.forEach((m, i) => {
  const content = String(m.content);
  if (m.role !== "system" && i !== last) {
    history += tokens(content);
    return;
  }
  const where = m.role === "system" ? "系统" : "最后一条";
  for (const block of content.split(/\n\n(?=【)/)) {
    const title = block.startsWith("【")
      ? block.slice(0, block.indexOf("】") + 1)
      : `（${[...block].slice(0, 14).join("")}…）`;
    if (title === "【当前状态】") state = block;
    rows.push({ where, title, tokens: tokens(block) });
  }
});

const total = rows.reduce((s, r) => s + r.tokens, 0) + history;
const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
console.log(`存档 ${pick}：${effectiveTurns(records).length} 轮，写正文提示词约 ${total} token`);
console.log(`对话历史（最近几轮原文）：${history}（${pct(history)}）`);
for (const r of [...rows].sort((a, b) => b.tokens - a.tokens)) {
  console.log(`${r.where}\t${r.tokens}\t${pct(r.tokens)}\t${r.title}`);
}
console.log("\n===== 【当前状态】原文 =====");
console.log(state);
