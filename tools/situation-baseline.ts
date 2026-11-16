/**
 * S3 情境进系统的验收：把 data/saves 下每个存档每一轮发给叙事模型的内容存成基准，改完再逐字比对。
 * 重建照服务端 GameService.context：从初始世界重放到这一轮之前，再拼 ① 判断、③ 写正文、④ 抽取；
 * 每个存档最后再按当前状态拼一轮「看看四周」，没有回合的存档也能比到情境。只读存档，不调用模型。
 *
 *   pnpm --filter @cp/tools exec tsx situation-baseline.ts          存基准
 *   pnpm --filter @cp/tools exec tsx situation-baseline.ts --check  和基准比对
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gameContent, gameData, openingPremise } from "@cp/content";
import {
  buildExtractPrompt,
  buildJudgePrompt,
  buildNarratorPrompt,
  effectiveTurns,
  HISTORY_TURNS,
  judgeCandidates,
  type LlmMessage,
  type LogRecord,
  memoryPool,
  type NarratorPlan,
  newGameWorld,
  parseLog,
  replay,
  type SaveMeta,
  SaveMetaSchema,
  type TurnInput,
  TurnInputSchema,
  type TurnRecord,
} from "@cp/core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVES = join(ROOT, "data", "saves");
const OUT = "/tmp/situation-baseline";
const check = process.argv.includes("--check");

interface Stage {
  readonly stage: string;
  readonly messages: readonly LlmMessage[];
}

/** 和 GameService.context 一样重建一轮；record 为 undefined 时按当前状态拼下一轮 */
function stagesFor(
  meta: SaveMeta,
  before: readonly LogRecord[],
  input: TurnInput,
  record?: TurnRecord,
): Stage[] {
  const world = replay({ nextSeq: 0, world: newGameWorld(meta, gameContent) }, before);
  const plan: NarratorPlan = { kind: "action", input };
  const extras = {
    data: gameData,
    opening: openingPremise(meta.opening),
    startTime: meta.startTime,
  };
  const stages: Stage[] = [];
  if (input.mode !== "ooc") {
    const lately = effectiveTurns(before)
      .slice(-2)
      .map((t) => t.text)
      .join("\n");
    const pool = memoryPool(
      world,
      before,
      record?.budget?.history ?? HISTORY_TURNS,
      record?.budget?.recapTokens,
    );
    const memories = judgeCandidates(pool, world, { input: input.text, context: lately });
    const judge = buildJudgePrompt(world, before, plan, extras, memories);
    stages.push({ stage: "judge", messages: judge.messages });
  }
  const narrate = buildNarratorPrompt(world, before, plan, {
    ...extras,
    decided: record?.decided,
    recalled: [...(record?.recalled ?? []), ...(record?.expanded ?? [])],
    lore: record?.lore?.section,
    history: record?.budget?.history,
    recapTokens: record?.budget?.recapTokens,
  });
  stages.push({ stage: "narrate", messages: narrate.messages });
  if (record === undefined || record.ooc !== true) {
    const extract = buildExtractPrompt(world, before, plan, extras, record?.text ?? "");
    stages.push({ stage: "extract", messages: extract.messages });
  }
  return stages;
}

/** 一个存档每一轮的情境；最后一项是按当前状态拼的下一轮 */
function situations(id: string): string {
  const dir = join(SAVES, id);
  const meta = SaveMetaSchema.parse(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")));
  const { records } = parseLog(readFileSync(join(dir, "turns.jsonl"), "utf8"));
  const rows: { seq: number | "next"; stages?: Stage[]; error?: string }[] = [];
  for (const record of effectiveTurns(records)) {
    const input = TurnInputSchema.safeParse(record.input);
    if (!input.success) {
      rows.push({ seq: record.seq, error: "这一轮的玩家输入格式不对" });
      continue;
    }
    try {
      rows.push({
        seq: record.seq,
        stages: stagesFor(meta, records.slice(0, record.seq), input.data, record),
      });
    } catch (error) {
      rows.push({ seq: record.seq, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const next = TurnInputSchema.parse({ text: "看看四周" });
  rows.push({ seq: "next", stages: stagesFor(meta, records, next) });
  return `${JSON.stringify(rows, null, 2)}\n`;
}

const ids = readdirSync(SAVES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("s-"))
  .map((e) => e.name)
  .sort();

mkdirSync(OUT, { recursive: true });
let failed = 0;
let rounds = 0;
for (const id of ids) {
  const file = join(OUT, `${id}.json`);
  let text: string;
  try {
    text = situations(id);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${id} 拼情境出错：${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  rounds += (JSON.parse(text) as unknown[]).length;
  if (!check) {
    writeFileSync(file, text);
    console.log(`存 ${id}（${text.length} 字符）`);
    continue;
  }
  if (!existsSync(file)) {
    failed += 1;
    console.log(`✗ ${id} 没有基准`);
    continue;
  }
  const before = readFileSync(file, "utf8");
  if (before === text) {
    console.log(`✓ ${id}`);
    continue;
  }
  failed += 1;
  writeFileSync(join(OUT, `${id}.after.json`), text);
  const a = before.split("\n");
  const b = text.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  console.log(`✗ ${id} 第 ${at + 1} 行起不同：\n  前 ${a[at] ?? "(无)"}\n  后 ${b[at] ?? "(无)"}`);
}
console.log(`${check ? "比对" : "存基准"}：${ids.length} 个存档、${rounds} 轮，${failed} 个不通过`);
if (failed > 0) process.exitCode = 1;
