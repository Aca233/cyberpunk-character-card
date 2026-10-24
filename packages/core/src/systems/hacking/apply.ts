import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { CombatState } from "../combat";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { checkFact } from "../dice";
import { HUMANITY_KINDS } from "../humanity";
import {
  CATEGORY_LABELS,
  type HackCommand,
  type HackingState,
  QuickhackCatalogSchema,
  type QuickhackDef,
  RAM_SEGMENT_REGEN,
} from "./schema";

type Hacking = Draft<HackingState>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });
const catalogs = new WeakMap<object, ReadonlyMap<string, QuickhackDef>>();

export function quickhackCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, QuickhackDef> {
  const raw = data.quickhacks;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(QuickhackCatalogSchema.parse(raw).map((q) => [q.id, q] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

/** 按装着的义体算接入仓、RAM 上限和程序格数；没有义体表时返回 undefined */
export function deckOf(
  installed: CyberwareState["installed"],
  data: Readonly<Record<string, unknown>>,
): { readonly deck: string | null; readonly ramMax: number; readonly slots: number } | undefined {
  const catalog = cyberwareCatalog(data);
  if (catalog.size === 0) return undefined;
  const defs = installed.flatMap((c) => catalog.get(c.id) ?? []);
  const deck = defs.find((d) => d.programSlots !== undefined);
  if (!deck) return { deck: null, ramMax: 0, slots: 0 };
  return {
    deck: deck.id,
    ramMax: defs.reduce((sum, d) => sum + (d.ram ?? 0), 0),
    slots: deck.programSlots ?? 0,
  };
}

/** 装卸义体以后同步接入仓和 RAM：换了接入仓按满格开机，上限变了按差值加减 */
export function syncDeck(draft: Hacking, ctx: SystemContext): number {
  const found = deckOf(ctx.read<CyberwareState>("cyberware").installed, ctx.data);
  if (!found) return 0;
  if (draft.deck !== found.deck) draft.ram = found.ramMax;
  else draft.ram = Math.max(0, Math.min(found.ramMax, draft.ram + found.ramMax - draft.ramMax));
  draft.deck = found.deck;
  draft.ramMax = found.ramMax;
  return found.slots;
}

/** 场景结束、战斗收尾、休整：RAM 回满 */
export function refill(draft: Hacking): void {
  draft.ram = draft.ramMax;
}

/** 战斗打完一段：回一部分 RAM */
export function regen(draft: Hacking): void {
  draft.ram = Math.min(draft.ramMax, draft.ram + RAM_SEGMENT_REGEN);
}

function findProgram(
  catalog: ReadonlyMap<string, QuickhackDef>,
  key: string,
): QuickhackDef | undefined {
  return catalog.get(key) ?? [...catalog.values()].find((q) => q.name === key);
}

export function applyHack(draft: Hacking, command: HackCommand, ctx: SystemContext): ApplyOutcome {
  const slots = syncDeck(draft, ctx);
  const catalog = quickhackCatalog(ctx.data);
  const def = findProgram(catalog, command.program);
  if (!def) return fail(`快速破解表里没有 ${command.program}`);
  if (!draft.deck) return fail("没装网络接入仓，放不了也装不了快速破解");
  const reason = command.reason ?? "";

  if (command.action === "learn") {
    if (draft.programs.includes(def.id)) return fail(`「${def.name}」已经装着了`);
    if (draft.programs.length >= slots) {
      return fail(`接入仓的程序格满了（${slots} 格），先 drop 一个`);
    }
    draft.programs.push(def.id);
    return {
      ok: true,
      notes: [`装上快速破解「${def.name}」：${reason}（程序格 ${draft.programs.length}/${slots}）`],
    };
  }
  if (command.action === "drop") {
    const i = draft.programs.indexOf(def.id);
    if (i < 0) return fail(`没装「${def.name}」`);
    draft.programs.splice(i, 1);
    return { ok: true, notes: [`删掉快速破解「${def.name}」：${reason}`] };
  }

  if (!draft.programs.includes(def.id)) {
    const names = draft.programs.map((id) => catalog.get(id)?.name ?? id);
    return fail(
      `没装「${def.name}」，只能放已装的程序：${names.length > 0 ? names.join("、") : "（一个都没装）"}`,
    );
  }
  if (draft.ram < def.ram) {
    return fail(`RAM 不够：「${def.name}」要 ${def.ram} 格，只剩 ${draft.ram} 格`);
  }
  if (command.npc !== undefined && checkFact(ctx.facts) === undefined) {
    return fail("对有人物卡的人放快速破解要先掷智力：本轮没有检定结果");
  }
  draft.ram -= def.ram;
  const notes = [
    `快速破解「${def.name}」（${CATEGORY_LABELS[def.category]}）→ ${command.target ?? ""}：RAM ${draft.ram}/${draft.ramMax}`,
  ];
  const emit: Command[] =
    def.category === "ultimate"
      ? [
          {
            type: "humanity",
            delta: HUMANITY_KINDS.cruelty.sizes.medium,
            reason: `终极快速破解「${def.name}」：${command.target ?? ""}`,
          },
        ]
      : [];
  const inCombat = ctx.read<CombatState>("combat").active !== null;
  return { ok: true, notes, emit, ...(inCombat ? { signals: ["combat.quick"] } : {}) };
}
