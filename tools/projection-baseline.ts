/**
 * S1 投影拆分的验收：把 data/saves 下每个存档的玩家投影存成基准，改完再逐字比对。
 * 只读存档：不用 SaveStore（它读到半行会截断日志），自己读 meta、日志和快照，
 * 重放流程照服务端 GameService.load：挑快照 → withAllSlices → replay → projectState。
 *
 *   pnpm --filter @cp/tools exec tsx projection-baseline.ts          存基准
 *   pnpm --filter @cp/tools exec tsx projection-baseline.ts --check  和基准比对
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gameContent, gameData } from "@cp/content";
import {
  newGameWorld,
  parseLog,
  pickSnapshot,
  projectState,
  replay,
  SaveMetaSchema,
  type Snapshot,
  withAllSlices,
} from "@cp/core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVES = join(ROOT, "data", "saves");
const OUT = "/tmp/projection-baseline";
const SNAPSHOT_FILE = /^\d{8}\.json$/;
const check = process.argv.includes("--check");

function isSnapshot(raw: unknown): raw is Snapshot {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as { nextSeq?: unknown; world?: { time?: unknown; slices?: unknown } };
  return (
    Number.isInteger(s.nextSeq) &&
    typeof s.world === "object" &&
    s.world !== null &&
    Number.isInteger(s.world.time) &&
    typeof s.world.slices === "object" &&
    s.world.slices !== null
  );
}

/** 和 SaveStore.readSnapshots 一样：坏掉的快照跳过，按 nextSeq 排 */
function readSnapshots(dir: string): Snapshot[] {
  if (!existsSync(dir)) return [];
  const out: Snapshot[] = [];
  for (const file of readdirSync(dir).filter((f) => SNAPSHOT_FILE.test(f))) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (isSnapshot(raw)) out.push(raw);
    } catch {
      // 快照只是缓存，坏了就从更早的快照或从头重放
    }
  }
  return out.sort((a, b) => a.nextSeq - b.nextSeq);
}

function project(id: string): string {
  const dir = join(SAVES, id);
  const meta = SaveMetaSchema.parse(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")));
  const { records } = parseLog(readFileSync(join(dir, "turns.jsonl"), "utf8"));
  const snapshot = pickSnapshot(readSnapshots(join(dir, "snapshots")), records) ?? {
    nextSeq: 0,
    world: newGameWorld(meta, gameContent),
  };
  const world = replay({ ...snapshot, world: withAllSlices(snapshot.world) }, records);
  return `${JSON.stringify(projectState(world, records, gameData), null, 2)}\n`;
}

const ids = readdirSync(SAVES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("s-"))
  .map((e) => e.name)
  .sort();

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const id of ids) {
  const file = join(OUT, `${id}.json`);
  let text: string;
  try {
    text = project(id);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${id} 投影出错：${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
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
console.log(`${check ? "比对" : "存基准"}：${ids.length} 个存档，${failed} 个不通过`);
if (failed > 0) process.exitCode = 1;
