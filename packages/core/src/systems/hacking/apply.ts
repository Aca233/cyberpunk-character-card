import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { CombatState } from "../combat";
import {
  type CyberwareDef,
  type CyberwareState,
  cyberwareCatalog,
  type DeckTrait,
} from "../cyberware";
import { npcHackRulingFact, rulingFact } from "../dice";
import type { HealthState } from "../health";
import { currentVitals, filledBody, type NpcState } from "../npc";
import type { WorldClockState } from "../world";
import {
  ACTIVE_HACK_KEEP,
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

/** 接入仓的定性摘要：哪一款、什么定位、特化方向和有没有完好的自我 ICE；不含容量或槽位数字 */
export interface DeckInfo {
  readonly deck: string | null;
  readonly deckName: string | null;
  readonly profile: string | null;
  readonly traits: readonly DeckTrait[];
  readonly selfIce: boolean;
}

const NO_DECK: DeckInfo = { deck: null, deckName: null, profile: null, traits: [], selfIce: false };
const SELF_ICE = "self-ice";

function deckFrom(defs: readonly CyberwareDef[]): DeckInfo {
  const selfIce = defs.some((d) => d.id === SELF_ICE);
  const deck = defs.find((d) => d.slot === "os" && d.deckTraits !== undefined);
  if (!deck) return { ...NO_DECK, selfIce };
  return {
    deck: deck.id,
    deckName: deck.name,
    profile: deck.deckProfile ?? null,
    traits: [...new Set(defs.flatMap((d) => d.deckTraits ?? []))],
    selfIce,
  };
}

/** 按装着且没被打坏的义体认接入仓和特化；没有义体表时返回 undefined */
export function deckOf(
  installed: CyberwareState["installed"],
  data: Readonly<Record<string, unknown>>,
  broken: readonly string[] = [],
): DeckInfo | undefined {
  const catalog = cyberwareCatalog(data);
  if (catalog.size === 0) return undefined;
  return deckFrom(
    installed.filter((c) => !broken.includes(c.id)).flatMap((c) => catalog.get(c.id) ?? []),
  );
}

/** 只从完好的设备同步接入仓；没有义体表时不改 */
export function syncDeck(draft: Hacking, ctx: SystemContext): void {
  const found = deckOf(
    ctx.read<CyberwareState>("cyberware").installed,
    ctx.data,
    ctx.read<HealthState>("health").brokenChrome,
  );
  if (found) draft.deck = found.deck;
}

function findProgram(
  catalog: ReadonlyMap<string, QuickhackDef>,
  key: string,
): QuickhackDef | undefined {
  return catalog.get(key) ?? [...catalog.values()].find((q) => q.name === key);
}

/** 黑墙攻击依赖接入仓本体的原型协议；普通配件的定性加成不能补出这项能力。 */
function blackwallAttackBlocked(
  deck: string,
  program: string,
  def: QuickhackDef | undefined,
  data: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!/(?:black[\s_-]*wall|黑墙)/i.test([program, def?.name, def?.effect].join(" ")))
    return undefined;
  const hardware = cyberwareCatalog(data).get(deck);
  return hardware?.slot === "os" && hardware.deckTraits?.includes("blackwall")
    ? undefined
    : "黑墙攻击需要实际装有完好的黑墙原型接入仓，普通入侵能力不能替代";
}

/** 快速破解一次行动内自然结算：登记活跃状态与高危反追踪警示，供后续裁决与战局读取；不设 RAM 或槽位门槛 */
export function applyHack(draft: Hacking, command: HackCommand, ctx: SystemContext): ApplyOutcome {
  syncDeck(draft, ctx);
  if (!draft.deck) return fail("没装完好的网络接入仓，放不了快速破解");
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") return fail(ruling.reason ?? "网络拓扑或实际条件阻断了上传");
  const def = findProgram(quickhackCatalog(ctx.data), command.program);
  const blocked = blackwallAttackBlocked(draft.deck, command.program, def, ctx.data);
  if (blocked) return fail(blocked);
  const location = ctx.read<WorldClockState>("world").location ?? null;
  const programId = def?.id ?? command.program;
  if (def && !draft.programs.includes(def.id)) {
    draft.programs.push(def.id);
  }
  const effectDesc = def?.effect ?? `${command.program}已作用于目标`;
  const existingIdx = draft.activeEffects.findIndex(
    (e) => e.program === programId && e.target === command.target && e.location === location,
  );
  const entry = {
    program: programId,
    label: def?.name ?? command.program,
    category: def?.category ?? null,
    target: command.target,
    ...(command.npc ? { npc: command.npc } : {}),
    location,
    at: ctx.now,
    effect: effectDesc,
  };
  if (existingIdx >= 0) {
    draft.activeEffects[existingIdx] = entry;
  } else {
    draft.activeEffects.push(entry);
    if (draft.activeEffects.length > ACTIVE_HACK_KEEP) {
      draft.activeEffects.splice(0, draft.activeEffects.length - ACTIVE_HACK_KEEP);
    }
  }
  const notes = [
    `快速破解${def ? `「${def.name}」（${CATEGORY_LABELS[def.category]}）` : `「${command.program}」`} → ${command.target}`,
  ];
  // 攻击型/终极型破解对未静音目标易引发对方黑客/安保反追踪警觉
  if (def && (def.category === "damage" || def.category === "ultimate")) {
    draft.traceAlert = { at: ctx.now, location, target: command.target };
    notes.push(`对方链路出现反向追踪信号（${command.target}）`);
  }
  return { ok: true, notes };
}

/** 场景结束或离开现场时，清理已失效的临时快速破解状态与本地反追踪警示 */
export function clearLocalHackEffects(draft: Hacking, location: string | null): void {
  draft.activeEffects = draft.activeEffects.filter(
    (e) => location !== null && e.location === location,
  );
  if (draft.traceAlert && draft.traceAlert.location !== location) {
    draft.traceAlert = null;
  }
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

/** 潜网：开始、记录本次目标内部的进一步接入、退出；档位不生成网络防线或权限。 */
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
      notes: command.reason ? [`L1：${command.reason}`] : [],
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
    return fail("已到本次目标的接入范围边界；访问其他网络须另行确认实际链路与接入条件");
  }
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "当前目标的链路、权限或防线阻断了进一步接入");
  }
  const target = dive.layer + 1;
  dive.layer = target;
  const noteText = command.reason ?? ruling?.reason;
  if (noteText) {
    dive.notes.push(`L${target}：${noteText}`);
  }
  return {
    ok: true,
    notes: [
      `当前目标接入深入程度：${target}/${DIVE_MAX}（${DIVE_LAYERS[target - 1]}）${target === DIVE_MAX ? "：已到本次目标范围边界" : ""}`,
    ],
  };
}

/** 有卡的人的接入仓与特化：按他身上完好的义体算，和玩家同一套定性摘要 */
export function npcDeckOf(
  cyberware: readonly string[],
  data: Readonly<Record<string, unknown>>,
  broken: readonly string[] = [],
): DeckInfo {
  const catalog = cyberwareCatalog(data);
  if (catalog.size === 0) return NO_DECK;
  const defs = cyberware
    .filter((id) => !broken.includes(id))
    .flatMap((id) => catalog.get(id) ?? []);
  return deckFrom(defs);
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
  const { deck } = npcDeckOf(filledBody(npc.body).cyberware, ctx.data);
  if (!deck) return fail(`${npc.name} 没装网络接入仓，放不了快速破解：照他的装备和义体换个打法`);
  const blocked = blackwallAttackBlocked(deck, command.program, def, ctx.data);
  if (blocked) return fail(`${npc.name}：${blocked}`);
  const harmful =
    command.target === "你" && (def.category === "damage" || def.category === "ultimate");
  const ruling = harmful ? npcHackRulingFact(ctx.facts) : undefined;
  if (harmful) {
    if (!ruling) return fail("缺少本轮神经对抗结果，不能凭程序类别登记伤害");
    if (draft.resolvedNpcHacks.includes(ruling.id)) {
      return fail("这一轮敌方快速破解已登记，不重复结算");
    }
    draft.resolvedNpcHacks.push(ruling.id);
  }
  const notes = [
    `${npc.name} 放快速破解「${def.name}」（${CATEGORY_LABELS[def.category]}）→ ${command.target}`,
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
