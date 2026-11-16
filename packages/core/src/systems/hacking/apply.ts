import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { CombatState } from "../combat";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { rulingFact } from "../dice";
import type { HealthState } from "../health";
import { currentVitals, filledBody, type NpcState } from "../npc";
import type { WorldClockState } from "../world";
import {
  BREACH_GAIN_LABELS,
  BREACH_KEEP,
  type BreachCommand,
  CATEGORY_LABELS,
  DIVE_LAYERS,
  DIVE_MAX,
  type DiveCommand,
  type HackCommand,
  type HackingState,
  type NpcHackCommand,
  QuickhackCatalogSchema,
  type QuickhackDef,
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

/** 只从完好的设备同步接入仓容量。 */
export function syncDeck(draft: Hacking, ctx: SystemContext): number {
  const broken = ctx.read<HealthState>("health").brokenChrome;
  const found = deckOf(
    ctx.read<CyberwareState>("cyberware").installed.filter((c) => !broken.includes(c.id)),
    ctx.data,
  );
  if (!found) return 0;
  draft.deck = found.deck;
  draft.ramMax = found.ramMax;
  return found.slots;
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
  if (def.ram > draft.ramMax) {
    return fail(`接入仓容量不足：「${def.name}」需要 ${def.ram} 格，设备只有 ${draft.ramMax} 格`);
  }
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") return fail(ruling.reason ?? "网络拓扑或实际条件阻断了上传");
  const notes = [
    `快速破解「${def.name}」（${CATEGORY_LABELS[def.category]}）→ ${command.target ?? ""}：设备容量 ${draft.ramMax} 格`,
  ];
  return { ok: true, notes };
}

/** 入侵协议按已确认的接入路径结算；同一地点的既有网络授权持续存在。 */
export function applyBreach(
  draft: Hacking,
  command: BreachCommand,
  ctx: SystemContext,
): ApplyOutcome {
  syncDeck(draft, ctx);
  if (!draft.deck) return fail("没装网络接入仓，做不了入侵协议");
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "目标存在物理气隙隔离或硬化防火墙，无法接入");
  }
  const location = ctx.read<WorldClockState>("world").location ?? null;
  if (draft.breachedNetworks.some((n) => n.name === command.network && n.location === location)) {
    return fail(`「${command.network}」已经入侵过了，不用再做一次`);
  }
  draft.breachedNetworks.push({
    name: command.network,
    location,
    at: ctx.now,
    gains: [...command.gains],
  });
  if (draft.breachedNetworks.length > BREACH_KEEP) {
    draft.breachedNetworks.splice(0, draft.breachedNetworks.length - BREACH_KEEP);
  }
  const gains = command.gains.map((g) => BREACH_GAIN_LABELS[g]).join("、");
  return {
    ok: true,
    notes: [
      `入侵协议：${command.network}${command.via ? `（从${command.via}接入）` : ""}，拿下${gains}`,
    ],
  };
}

/** 潜网：开始、往下潜一层、退出 */
export function applyDive(draft: Hacking, command: DiveCommand, ctx: SystemContext): ApplyOutcome {
  syncDeck(draft, ctx);
  if (command.action === "surface") {
    if (!draft.dive) return fail("没在潜网");
    const layer = draft.dive.layer;
    draft.dive = null;
    return { ok: true, notes: [`退出潜网，从第 ${layer} 层（${DIVE_LAYERS[layer - 1]}）回到肉身`] };
  }
  if (command.action === "start") {
    if (!draft.deck) return fail("没装网络接入仓，潜不了网");
    if (draft.dive) return fail(`已经在潜网（第 ${draft.dive.layer} 层）`);
    if (ctx.read<CombatState>("combat").active) return fail("战斗中不能潜网：肉身顾不上");
    draft.dive = {
      layer: 1,
      startedAt: ctx.now,
      chair: command.chair ?? "",
      guard: command.guard ?? "",
    };
    return {
      ok: true,
      notes: [
        `躺上${command.chair}接进网络，${command.guard}守着肉身：第 1 层（${DIVE_LAYERS[0]}）`,
      ],
    };
  }
  const dive = draft.dive;
  if (!dive) return fail("没在潜网，先 start");
  if (dive.layer >= DIVE_MAX) {
    return fail("已经到黑墙边缘，再往里是黑墙，过不去；后面是流窜 AI");
  }
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "深层冰墙阻断了通道，没能继续往下潜");
  }
  const target = dive.layer + 1;
  dive.layer = target;
  return {
    ok: true,
    notes: [
      `往下潜到第 ${target}/${DIVE_MAX} 层（${DIVE_LAYERS[target - 1]}）${target === DIVE_MAX ? "：再往里就是黑墙" : ""}`,
    ],
  };
}

/** 有卡的人的接入仓和 RAM 上限：按他身上装着的义体算，和玩家同一套（接入仓给底数，其他义体再加） */
export function npcDeckOf(
  cyberware: readonly string[],
  data: Readonly<Record<string, unknown>>,
): { readonly deck: string | null; readonly ramMax: number } {
  const catalog = cyberwareCatalog(data);
  const defs = cyberware.flatMap((id) => catalog.get(id) ?? []);
  const deck = defs.find((d) => d.programSlots !== undefined);
  if (!deck) return { deck: null, ramMax: 0 };
  return { deck: deck.name, ramMax: defs.reduce((sum, d) => sum + (d.ram ?? 0), 0) };
}

/**
 * NPC 上传程序需有可用接入仓和实际运行条件。
 * 伤害来自本轮明确的神经损伤事实，与去重标记原子提交；不会因程序类别自动扣人性。
 */
export function applyNpcHack(
  draft: Hacking,
  command: NpcHackCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const npc = ctx.read<NpcState>("npc").npcs[command.id];
  if (!npc) return fail(`【人物】里没有 ${command.id}`);
  if (!npc.alive) return fail(`${npc.name} 已经死了`);
  if (currentVitals(npc, ctx.data, ctx.now).condition !== "up")
    return fail(`${npc.name} 倒下了，放不了快速破解`);
  const def = findProgram(quickhackCatalog(ctx.data), command.program);
  if (!def) return fail(`快速破解表里没有 ${command.program}`);
  const { deck, ramMax } = npcDeckOf(filledBody(npc.body).cyberware, ctx.data);
  if (!deck) return fail(`${npc.name} 没装网络接入仓，放不了快速破解：照他的装备和义体换个打法`);
  if (def.ram > ramMax)
    return fail(
      `${npc.name} 的接入仓容量不足：「${def.name}」需要 ${def.ram} 格，设备只有 ${ramMax} 格`,
    );
  const harmful =
    command.target === "你" && (def.category === "damage" || def.category === "ultimate");
  const ruling = harmful ? rulingFact(ctx.facts) : undefined;
  if (harmful) {
    if (!ruling) return fail("缺少本轮神经对抗结果，不能凭程序类别登记伤害");
    if (draft.resolvedNpcHacks.includes(ruling.id)) {
      return fail("这一轮敌方快速破解已登记，不重复结算");
    }
    draft.resolvedNpcHacks.push(ruling.id);
  }
  const ramNote = `${npc.name} 的接入仓容量 ${ramMax} 格`;
  const notes = [
    `${npc.name} 放快速破解「${def.name}」（${CATEGORY_LABELS[def.category]}）→ ${command.target}：${ramNote}`,
  ];
  if (harmful) {
    notes.push("本次快速破解统一登记已确认的神经损伤，不另记 damage 或 combat wound");
  }
  const emit: Command[] = [];
  if (harmful && ruling?.harm !== undefined && ruling.harm !== "none") {
    emit.push({
      type: "damage",
      tier: ruling.harm,
      part: "head",
      reason: `${npc.name}的快速破解「${def.name}」`,
    });
  } else if (harmful) {
    notes.push("没有确认神经损伤，不登记伤势");
  }
  return { ok: true, notes, emit };
}
