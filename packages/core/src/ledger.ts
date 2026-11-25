import { applyRecordPatches, type LogRecord, voidedSeqs } from "./kernel/turnlog";
import type { Snapshot, WorldState } from "./kernel/world";
import { healthDisplay } from "./systems/health/apply";
import { HealthStateSchema } from "./systems/health/schema";
import { neuralDisplay } from "./systems/humanity/apply";
import { HumanityStateSchema } from "./systems/humanity/schema";

/** 账目对账默认看最近几轮 */
export const LEDGER_TURNS = 10;

/** 一项硬数值在这条记录前后的值；之前没有（新认识的人）为 null */
export interface LedgerChange {
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
}

/** 一条改过状态的记录：有效回合，或其间改了硬数值的界面操作 */
export interface LedgerEntry {
  readonly seq: number;
  readonly kind: "turn" | "action";
  readonly changes: readonly LedgerChange[];
  readonly commands: readonly unknown[];
}

type Bag = Readonly<Record<string, unknown>> | undefined;

function num(slice: unknown, key: string): number | undefined {
  const v = (slice as Bag)?.[key];
  return typeof v === "number" ? v : undefined;
}

/** 欧元、人性、生命、通缉星、已知事迹数和每个人的好感；只读这几个字段，不校验整片状态 */
export function hardStats(world: WorldState): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const put = (label: string, v: number | undefined) => {
    if (v !== undefined) out.set(label, v);
  };
  const s = world.slices as Readonly<Record<string, unknown>>;
  put("欧元", num(s.economy, "eddies"));
  const humanityParsed = HumanityStateSchema.safeParse(s.humanity);
  put(
    "人性",
    humanityParsed.success ? neuralDisplay(humanityParsed.data) : num(s.humanity, "current"),
  );
  const healthParsed = HealthStateSchema.safeParse(s.health);
  put("生命", healthParsed.success ? healthDisplay(healthParsed.data).hp : num(s.health, "hp"));
  put("通缉星", num(s.heat, "stars") ?? 0);
  const deeds = (s.character as Bag)?.deeds;
  if (Array.isArray(deeds)) put("外界事迹", deeds.length);
  return out;
}

/** 前后不一样的项，按出现顺序 */
export function diffStats(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): LedgerChange[] {
  const changes: LedgerChange[] = [];
  for (const label of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(label) ?? null;
    const a = after.get(label) ?? null;
    if (a !== b) changes.push({ label, before: b, after: a });
  }
  return changes;
}

/**
 * 账目对账：从快照往后按补丁重放，列出最近 limit 个有效回合（和其间改了硬数值的界面操作）
 * 各改了哪些硬数值、当时生效的指令。records 截到要看的那一轮为止；只供剧透视图，不进提示词
 */
export function buildLedger(
  base: Snapshot,
  records: readonly LogRecord[],
  limit = LEDGER_TURNS,
): LedgerEntry[] {
  const voided = voidedSeqs(records);
  const turns = records.filter((r) => r.kind === "turn" && !voided.has(r.seq)).slice(-limit);
  const from = turns[0]?.seq;
  if (from === undefined) return [];
  const entries: LedgerEntry[] = [];
  let world = base.world;
  for (const r of records.slice(base.nextSeq)) {
    if (r.kind === "void" || r.kind === "check" || voided.has(r.seq)) continue;
    const next: WorldState = applyRecordPatches(world, r.patches);
    if (r.seq >= from && (r.kind === "turn" || r.kind === "action")) {
      const changes = diffStats(hardStats(world), hardStats(next));
      if (r.kind === "turn" || changes.length > 0) {
        entries.push({ seq: r.seq, kind: r.kind, changes, commands: r.commands });
      }
    }
    world = next;
  }
  return entries;
}
