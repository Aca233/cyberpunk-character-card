import { applyPatches } from "immer";
import { type LogRecord, voidedSeqs } from "./kernel/turnlog";
import type { Snapshot, WorldState } from "./kernel/world";

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

/** 欧元、人性、生命、通缉星、街头声望和每个人的好感；只读这几个字段，不校验整片状态 */
export function hardStats(world: WorldState): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const put = (label: string, v: number | undefined) => {
    if (v !== undefined) out.set(label, v);
  };
  const s = world.slices as Readonly<Record<string, unknown>>;
  put("欧元", num(s.economy, "eddies"));
  put("人性", num(s.humanity, "current"));
  put("生命", num(s.health, "hp"));
  put("通缉星", num(s.heat, "stars") ?? 0);
  put("街头声望", num(s.character, "streetCred"));
  const npcs = (s.npc as Bag)?.npcs;
  if (typeof npcs === "object" && npcs !== null) {
    for (const [id, n] of Object.entries(npcs as Record<string, Bag>)) {
      const name = typeof n?.name === "string" ? n.name : id;
      const label = out.has(`好感·${name}`) ? `好感·${name}（${id}）` : `好感·${name}`;
      put(label, num(n, "affinity"));
    }
  }
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
    const next: WorldState = applyPatches(world, r.patches);
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
