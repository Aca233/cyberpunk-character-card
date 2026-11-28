import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext, TimeSpan } from "../../kernel/system";
import type { CombatState } from "../combat";
import {
  type CyberwareDef,
  type CyberwareState,
  cyberwareCatalog,
  type DeckTrait,
} from "../cyberware";
import { npcHackRulingFact, rulingFact } from "../dice";
import type { HealthState } from "../health";
import {
  type InventoryState,
  itemCatalog,
  summarizeGearEffects,
  withWorldObjects,
} from "../inventory";
import { currentVitals, filledBody, type NpcState } from "../npc";
import { ALERT_MAX, currentAlert, type StealthState } from "../stealth";
import type { TensionState } from "../tension";
import type { WorldClockState } from "../world";
import {
  ACTIVE_HACK_KEEP,
  BREACH_GAIN_LABELS,
  BREACH_KEEP,
  BREACHED_TARGET_KEEP,
  type BreachCommand,
  CATEGORY_LABELS,
  type DeckLoadCommand,
  DIVE_LAYERS,
  DIVE_MAX,
  type DiveCommand,
  HACK_LOAD_LABELS,
  type HackCommand,
  type HackingState,
  type HackLoad,
  type NpcHackCommand,
  QuickhackCatalogSchema,
  type QuickhackDef,
  THERMAL_LABELS,
  THERMAL_MAX_HEAT,
  type ThermalLevel,
} from "./schema";

type Hacking = Draft<HackingState>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function resolveAlertLocation(ctx: SystemContext): string | null {
  const loc = ctx.read<WorldClockState>("world").location;
  if (loc !== null) return loc;
  const origin = ctx.facts.actionStartLocation;
  return typeof origin === "string" ? origin : null;
}
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

/** 接入仓的硬件摘要：哪一款、程序槽数、定位、特化方向和完好自我 ICE */
export interface DeckInfo {
  readonly deck: string | null;
  readonly deckName: string | null;
  readonly profile: string | null;
  readonly slots: number;
  readonly traits: readonly DeckTrait[];
  readonly selfIce: boolean;
}

const NO_DECK: DeckInfo = {
  deck: null,
  deckName: null,
  profile: null,
  slots: 0,
  traits: [],
  selfIce: false,
};

/** 新装接入仓出厂预装的基础街头程序（避免有仓却完全放不了基础破解；高阶与终极程序仍需另行获取芯片） */
export const STARTER_DECK_PROGRAMS: readonly string[] = [
  "ping",
  "reboot-optics",
  "weapon-glitch",
  "overheat",
];

function slotsForDeck(deck: CyberwareDef): number {
  if (deck.deckSlots !== undefined) return deck.deckSlots;
  switch (deck.rarity) {
    case "legendary":
      return 8;
    case "epic":
    case "rare":
      return 6;
    default:
      return 4;
  }
}

function deckFrom(defs: readonly CyberwareDef[]): DeckInfo {
  const selfIce = defs.some((d) => d.defenses?.includes("ice") === true);
  const deck = defs.find(
    (d) => d.slot === "os" && (d.deckTraits !== undefined || d.deckProfile !== undefined),
  );
  if (!deck) return { ...NO_DECK, selfIce };
  return {
    deck: deck.id,
    deckName: deck.name,
    profile: deck.deckProfile ?? null,
    slots: slotsForDeck(deck),
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

/** 热负荷内部刻度映射到四档定性状态 */
export function thermalLevelOf(heat: number): ThermalLevel {
  if (heat <= 0) return "cool";
  if (heat <= 2) return "warm";
  if (heat <= 4) return "hot";
  return "critical";
}

/** 根据经过的分钟数与当前散热条件计算自然降温后的热负荷刻度（纯函数，view 与 apply 共用） */
export function effectiveHeatAt(
  thermal: HackingState["thermal"],
  now: number,
  opts?: {
    readonly hasRecovery?: boolean;
    readonly inDiveChair?: boolean;
    readonly thermalRelief?: number;
  },
): number {
  const raw = Math.max(0, Math.min(THERMAL_MAX_HEAT, thermal.heat));
  if (raw === 0) return 0;
  const elapsed = Math.max(0, now - thermal.updatedAt);
  if (elapsed === 0) return raw;
  // 普通街头自然降温：约每 5 分钟散掉 1 档积热；配散热缓冲义体、潜网服/冷却头环或潜网椅时降温更快
  const baseStep = opts?.inDiveChair ? 2 : opts?.hasRecovery ? 3 : 5;
  const stepMinutes = Math.max(2, baseStep - (opts?.thermalRelief ?? 0));
  const cooled = Math.floor(elapsed / stepMinutes);
  return Math.max(0, raw - cooled);
}

/** 读取当前穿着的潜网服/冷却头环提供的黑客散热档位 */
function wornThermalRelief(ctx: SystemContext): number {
  if (ctx.data.items === undefined) return 0;
  const inv = ctx.read<InventoryState>("inventory");
  const catalog = itemCatalog(withWorldObjects(ctx.data, inv.objects));
  return summarizeGearEffects(inv, catalog).netThermalRelief;
}

/** 确保接入仓在首次安装或旧存档升级时有合理的已插装程序芯片与芯片库 */
export function ensureStarterPrograms(
  draft: Hacking,
  slots: number,
  data: Readonly<Record<string, unknown>>,
): void {
  const catalog = quickhackCatalog(data);
  const starter =
    catalog.size > 0
      ? STARTER_DECK_PROGRAMS.filter((id) => catalog.has(id))
      : [...STARTER_DECK_PROGRAMS];
  const hasExisting =
    draft.starterSeeded ||
    draft.programs.length > 0 ||
    draft.ownedPrograms.some((id) => starter.includes(id));

  if (!hasExisting) {
    for (const id of starter) {
      if (!draft.ownedPrograms.includes(id)) draft.ownedPrograms.push(id);
    }
    const limit = slots > 0 ? slots : draft.ownedPrograms.length;
    draft.programs = draft.ownedPrograms.slice(0, limit);
    draft.starterSeeded = true;
    return;
  }

  draft.starterSeeded = true;
  for (const id of draft.programs) {
    if (!draft.ownedPrograms.includes(id)) draft.ownedPrograms.push(id);
  }
  if (slots > 0 && draft.programs.length > slots) {
    draft.programs = draft.programs.slice(0, slots);
  }
}

/** 同步商店购入的快速破解程序芯片（通过 inventory.claimedQuickhacks 跨系统交接，避免 inventory→hacking 循环依赖） */
export function syncClaimedQuickhacks(draft: Hacking, ctx: SystemContext): void {
  const claimed = ctx.read<InventoryState>("inventory").claimedQuickhacks ?? [];
  if (claimed.length === 0) return;
  const catalog = quickhackCatalog(ctx.data);
  const found = syncDeck(draft, ctx);
  const slots = found?.deck ? found.slots : 0;
  for (const id of claimed) {
    if (catalog.size > 0 && !catalog.has(id)) continue;
    const isNew = !draft.ownedPrograms.includes(id);
    if (isNew) draft.ownedPrograms.push(id);
    if (isNew && found?.deck && !draft.programs.includes(id) && draft.programs.length < slots) {
      draft.programs.push(id);
    }
  }
}

/** 只从完好的设备同步接入仓与出厂基础程序；没有义体表时不改 */
export function syncDeck(draft: Hacking, ctx: SystemContext): DeckInfo | undefined {
  const found = deckOf(
    ctx.read<CyberwareState>("cyberware").installed,
    ctx.data,
    ctx.read<HealthState>("health").brokenChrome,
  );
  if (!found) return undefined;
  draft.deck = found.deck;
  if (found.deck) {
    ensureStarterPrograms(draft, found.slots, ctx.data);
  }
  return found;
}

/** 随游戏时间推进自然散热 */
export function coolThermalOverTime(draft: Hacking, span: TimeSpan, ctx: SystemContext): void {
  if (draft.thermal.heat <= 0) {
    draft.thermal.updatedAt = span.to;
    return;
  }
  const found = deckOf(
    ctx.read<CyberwareState>("cyberware").installed,
    ctx.data,
    ctx.read<HealthState>("health").brokenChrome,
  );
  const nextHeat = effectiveHeatAt(draft.thermal, span.to, {
    hasRecovery: found?.traits.includes("recovery") ?? false,
    inDiveChair: draft.dive !== null,
    thermalRelief: wornThermalRelief(ctx),
  });
  if (nextHeat !== draft.thermal.heat) {
    draft.thermal.heat = nextHeat;
    draft.thermal.updatedAt = span.to;
  }
}

function findProgram(
  catalog: ReadonlyMap<string, QuickhackDef>,
  key: string,
): QuickhackDef | undefined {
  return catalog.get(key) ?? [...catalog.values()].find((q) => q.name === key);
}

/** 不同算力档位单次上传带来的基础积热（潜网椅、散热义体与潜网服/冷却装备共同缓解） */
function heatDeltaFor(
  load: HackLoad,
  hasRecovery: boolean,
  inDiveChair: boolean,
  thermalRelief = 0,
): number {
  const base = load === "light" ? 1 : load === "medium" ? 2 : load === "heavy" ? 3 : 4;
  let relief = 0;
  if (inDiveChair && base > 1) relief += 1;
  if (hasRecovery && base >= 3) relief += 1;
  if (thermalRelief >= 1 && base >= 2) relief += 1;
  if (thermalRelief >= 2 && base >= 4) relief += 1;
  return Math.max(1, base - relief);
}

function sameHackTarget(
  entry: { readonly target: string; readonly npc?: string | undefined },
  target: string,
  npc: string | undefined,
): boolean {
  if (npc !== undefined || entry.npc !== undefined) return npc !== undefined && entry.npc === npc;
  return entry.target === target;
}

/** 目标是否已在本现场捅穿个人黑冰（建立立足点） */
export function hasTargetFoothold(
  state: Pick<HackingState, "breachedTargets" | "activeEffects">,
  target: string,
  npc: string | undefined,
  location: string | null,
): boolean {
  const matchLocation = (loc: string | null) => loc === null || loc === location;
  if (
    state.breachedTargets.some((b) => matchLocation(b.location) && sameHackTarget(b, target, npc))
  ) {
    return true;
  }
  // 已经在该目标身上成功跑通了前期控制/隐蔽/破冰破解，也视为已在神经端口留下立足点
  return state.activeEffects.some(
    (e) => matchLocation(e.location) && sameHackTarget(e, target, npc) && e.category !== "ultimate",
  );
}

function recordBreachedTarget(
  draft: Hacking,
  target: string,
  npc: string | undefined,
  location: string | null,
  at: number,
  via?: string,
): void {
  const exists = draft.breachedTargets.findIndex(
    (b) => b.location === location && sameHackTarget(b, target, npc),
  );
  const entry = {
    target,
    ...(npc ? { npc } : {}),
    location,
    at,
    ...(via ? { via } : {}),
  };
  if (exists >= 0) {
    draft.breachedTargets[exists] = entry;
  } else {
    draft.breachedTargets.push(entry);
    if (draft.breachedTargets.length > BREACHED_TARGET_KEEP) {
      draft.breachedTargets.splice(0, draft.breachedTargets.length - BREACHED_TARGET_KEEP);
    }
  }
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

/** 管理接入仓程序芯片：购入/拷贝新芯片，或在脱战且未潜网时插拔存储插槽 */
export function applyDeckLoad(
  draft: Hacking,
  command: DeckLoadCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const found = syncDeck(draft, ctx);
  const catalog = quickhackCatalog(ctx.data);
  const def = findProgram(catalog, command.program);
  if (!def) return fail(`快速破解程序目录里没有「${command.program}」`);

  if (command.action === "acquire") {
    const alreadyOwned = draft.ownedPrograms.includes(def.id);
    if (!alreadyOwned) draft.ownedPrograms.push(def.id);
    if (!draft.deck) {
      return {
        ok: true,
        notes: [
          alreadyOwned
            ? `随身芯片盒里已有「${def.name}」程序芯片`
            : `取得程序芯片「${def.name}」收进随身芯片盒（尚未安装完好网络接入仓，装仓后可插装进存储插槽）`,
        ],
      };
    }
    const slots = found?.slots ?? 4;
    if (!draft.programs.includes(def.id) && draft.programs.length < slots) {
      draft.programs.push(def.id);
      return {
        ok: true,
        notes: [
          `取得并插装程序芯片「${def.name}」（${HACK_LOAD_LABELS[def.load]}），当前存储插槽 ${draft.programs.length}/${slots}`,
        ],
      };
    }
    if (alreadyOwned) {
      return { ok: true, notes: [`随身芯片盒里已有「${def.name}」程序芯片`] };
    }
    return {
      ok: true,
      notes: [
        `取得程序芯片「${def.name}」收进随身芯片盒（当前接入仓 ${draft.programs.length}/${slots} 个存储插槽已满，脱战后可换插）`,
      ],
    };
  }

  if (!draft.deck) return fail("没装完好的网络接入仓，没法插拔存储插槽里的程序芯片");
  const slots = found?.slots ?? 4;

  if (ctx.read<CombatState>("combat").active) {
    return fail("交火中没工夫腾手拆换接入仓里的程序芯片，脱战后再插拔");
  }
  if (draft.dive !== null) {
    return fail("潜网连接维持中不能热插拔接入仓里的程序芯片，先退回肉身再换槽");
  }

  if (command.action === "unslot") {
    const idx = draft.programs.indexOf(def.id);
    if (idx < 0) return fail(`接入仓存储插槽里没有插着「${def.name}」`);
    draft.programs.splice(idx, 1);
    if (!draft.ownedPrograms.includes(def.id)) draft.ownedPrograms.push(def.id);
    return {
      ok: true,
      notes: [
        `已从接入仓存储插槽拔下「${def.name}」退回随身芯片盒（${draft.programs.length}/${slots}）`,
      ],
    };
  }

  // slot
  if (draft.programs.includes(def.id)) {
    return fail(`「${def.name}」已经插在接入仓存储插槽里了`);
  }
  if (!draft.ownedPrograms.includes(def.id)) {
    return fail(`你还没取得「${def.name}」的程序芯片，得先去黑客铺子购买、拷贝或从敌人身上搜刮`);
  }
  if (draft.programs.length >= slots) {
    if (!command.replace) {
      return fail(
        `接入仓的 ${slots} 个存储插槽已满（当前：${draft.programs.map((id) => catalog.get(id)?.name ?? id).join("、")}），换插须先拔下一张芯片`,
      );
    }
    const repDef = findProgram(catalog, command.replace);
    const repId = repDef?.id ?? command.replace;
    const repIdx = draft.programs.indexOf(repId);
    if (repIdx < 0) {
      return fail(`要换下的「${command.replace}」不在当前接入仓存储插槽里`);
    }
    draft.programs.splice(repIdx, 1, def.id);
    return {
      ok: true,
      notes: [
        `从存储插槽拔下「${repDef?.name ?? repId}」，换插程序芯片「${def.name}」（${draft.programs.length}/${slots}）`,
      ],
    };
  }
  draft.programs.push(def.id);
  return {
    ok: true,
    notes: [`已将程序芯片「${def.name}」插进接入仓存储插槽（${draft.programs.length}/${slots}）`],
  };
}

/**
 * 电子战快速破解结算：
 * 1. 检查完好接入仓 + 前置物理/信号/黑冰裁决（blocked 时拦截）
 * 2. 目录程序必须已插装在接入仓程序槽内（街头临时改写脚本允许但高热受限）
 * 3. 终极神经接管类必须先捅穿目标个人黑冰建立立足点
 * 4. 按算力档位累计接入仓与神经热负荷；已在过热临界强行硬发会反烧大脑并结算神经创伤
 */
export function applyHack(draft: Hacking, command: HackCommand, ctx: SystemContext): ApplyOutcome {
  const found = syncDeck(draft, ctx);
  if (!draft.deck) return fail("没装完好的网络接入仓，放不了快速破解");
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked")
    return fail(ruling.reason ?? "目标缺少有效信号接口、端口离线或被黑冰阻断");
  const catalog = quickhackCatalog(ctx.data);
  const def = findProgram(catalog, command.program);
  const blocked = blackwallAttackBlocked(draft.deck, command.program, def, ctx.data);
  if (blocked) return fail(blocked);

  const location = ctx.read<WorldClockState>("world").location ?? null;
  const programId = def?.id ?? command.program;

  // 程序槽硬校验：目录中的正式快速破解程序必须已插在接入仓槽位里
  if (def && !draft.programs.includes(def.id)) {
    const owned = draft.ownedPrograms.includes(def.id);
    const loadedNames = draft.programs.map((id) => catalog.get(id)?.name ?? id).join("、") || "无";
    return fail(
      owned
        ? `接入仓里没插「${def.name}」芯片（它还在你芯片盒里；当前已插装：${loadedNames}），得脱战换插后才能直接上传`
        : `你接入仓里没装「${def.name}」程序芯片（当前已插装：${loadedNames}），无法直接上传该程序`,
    );
  }

  // 破冰前置校验：终极神经接管类必须先捅穿目标个人黑冰建立立足点
  if (def?.requiresFoothold) {
    const hasFoothold =
      command.iceBreached === true ||
      hasTargetFoothold(draft, command.target, command.npc, location);
    if (!hasFoothold) {
      return fail(
        `「${def.name}」需要强行接管对方中枢神经，必须先捅穿「${command.target}」的个人黑冰建立入侵立足点，不能起手瞬发`,
      );
    }
  }

  // 先结算截至当前时间的自然散热，再累加本次程序的算力热负荷
  const hasRecovery = found?.traits.includes("recovery") ?? false;
  const inDiveChair = draft.dive !== null;
  const thermalRelief = wornThermalRelief(ctx);
  const heatBefore = effectiveHeatAt(draft.thermal, ctx.now, {
    hasRecovery,
    inDiveChair,
    thermalRelief,
  });
  const levelBefore = thermalLevelOf(heatBefore);
  const load: HackLoad = def?.load ?? "medium";
  const delta = heatDeltaFor(load, hasRecovery, inDiveChair, thermalRelief);
  const heatAfter = Math.min(THERMAL_MAX_HEAT, heatBefore + delta);
  const levelAfter = thermalLevelOf(heatAfter);

  draft.thermal.heat = heatAfter;
  draft.thermal.updatedAt = ctx.now;

  // 如果原本已经处于过热临界（或发烫状态硬发极高过载程序），强行上传会烧灼神经突触造成真实头部神经伤
  const overheatedCast =
    levelBefore === "critical" || (levelBefore === "hot" && load === "extreme");
  const emit: Command[] = [];

  if (command.iceBreached || (def && !def.requiresFoothold)) {
    recordBreachedTarget(
      draft,
      command.target,
      command.npc,
      location,
      ctx.now,
      def?.name ?? command.program,
    );
  }

  const effectDesc = def?.effect ?? `${command.program}已作用于目标硬件`;
  const existingIdx = draft.activeEffects.findIndex(
    (e) =>
      e.program === programId &&
      sameHackTarget(e, command.target, command.npc) &&
      e.location === location,
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
    `电子战破解${def ? `「${def.name}」（${CATEGORY_LABELS[def.category]}/${HACK_LOAD_LABELS[load]}）` : `「${command.program}」`} → ${command.target}｜热负荷：${THERMAL_LABELS[levelAfter]}`,
  ];

  if (overheatedCast) {
    draft.thermal.overloadCount += 1;
    const tier =
      levelBefore === "critical" && (load === "heavy" || load === "extreme") ? "heavy" : "graze";
    emit.push({
      type: "health.hit",
      tier,
      part: "head",
      source: "injury",
      injuryId: `hackOverheat:${ctx.now}:${draft.thermal.overloadCount}`,
      reason: `接入仓过热硬发「${def?.name ?? command.program}」引发神经过载灼伤`,
    });
    notes.push(
      tier === "heavy"
        ? "接入仓彻底过载滚烫！强行连发烧灼脑神经（鼻血涌出、视界重影，登记头部神经重创）"
        : "接入仓已在过热边缘，强行上传引发神经刺痛与鼻血（登记头部神经擦伤）",
    );
  } else if (levelAfter === "critical") {
    notes.push("警告：接入仓与脑神经已达过载临界！继续强发破解会直接烧伤大脑，需立即停手散热");
  }

  // 攻击型/终极型破解对未静音目标易引发对方黑客/安保反追踪警觉
  if (def && (def.category === "damage" || def.category === "ultimate")) {
    draft.traceAlert = { at: ctx.now, location, target: command.target };
    notes.push(`对方链路出现反向追踪信号（${command.target}）`);
  } else if (def?.id === "memory-wipe") {
    if (draft.traceAlert) {
      draft.traceAlert = null;
      notes.push("记忆擦除覆写了回传日志，中断了当前的反向追踪信号");
    }
    if (!ctx.read<CombatState>("combat").active) {
      const alertLoc = resolveAlertLocation(ctx);
      const alertLevel = currentAlert(ctx.read<StealthState>("stealth"), alertLoc).level;
      if (alertLevel === 1) {
        emit.push({
          type: "alert",
          delta: -1,
          ...(alertLoc ? { location: alertLoc } : {}),
          reason: "记忆擦除中断了目标的起疑与警报回传",
        });
        notes.push("目标起疑已被抹除，现场警戒回落");
      }
    }
  }

  return emit.length > 0 ? { ok: true, notes, emit } : { ok: true, notes };
}

/** 场景结束或离开现场时，清理已失效的临时快速破解状态、现场破冰立足点与本地反追踪警示 */
export function clearLocalHackEffects(draft: Hacking, location: string | null): void {
  draft.activeEffects = draft.activeEffects.filter(
    (e) => location !== null && e.location === location,
  );
  draft.breachedTargets = draft.breachedTargets.filter(
    (b) => location !== null && b.location === location,
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
  const found = syncDeck(draft, ctx);
  if (!draft.deck) return fail("没装网络接入仓，做不了入侵协议");
  const ruling = rulingFact(ctx.facts);
  if (ruling?.kind === "blocked") {
    return fail(ruling.reason ?? "目标存在物理气隙隔离或硬化防火墙，无法接入");
  }
  const location = ctx.read<WorldClockState>("world").location ?? null;
  const existing = draft.breachedNetworks.find(
    (n) => n.name === command.network && n.location === location,
  );
  const newGains = [...new Set(command.gains)].filter((gain) => !existing?.gains.includes(gain));
  if (newGains.length === 0) {
    return { ok: true, notes: [`「${command.network}」的这些权限已经掌握，无需重复入侵`] };
  }
  if (existing) {
    existing.gains.push(...newGains);
    existing.at = ctx.now;
    // 扩权后的网络仍按最近一次成功接入排序，不因其他网络入侵而提前滚出记录。
    draft.breachedNetworks.splice(draft.breachedNetworks.indexOf(existing), 1);
    draft.breachedNetworks.push(existing);
  } else {
    draft.breachedNetworks.push({
      name: command.network,
      location,
      at: ctx.now,
      gains: newGains,
    });
  }
  if (draft.breachedNetworks.length > BREACH_KEEP) {
    draft.breachedNetworks.splice(0, draft.breachedNetworks.length - BREACH_KEEP);
  }
  // 跑通入侵协议会产生轻微算力积热
  const hasRecovery = found?.traits.includes("recovery") ?? false;
  const heatBefore = effectiveHeatAt(draft.thermal, ctx.now, {
    hasRecovery,
    inDiveChair: draft.dive !== null,
  });
  draft.thermal.heat = Math.min(THERMAL_MAX_HEAT, heatBefore + 1);
  draft.thermal.updatedAt = ctx.now;

  const gains = newGains.map((g) => BREACH_GAIN_LABELS[g]).join("、");
  const notes = [
    `入侵协议：${command.network}${command.via ? `（从${command.via}接入）` : ""}，拿下${gains}`,
  ];
  const emit: Command[] = [];
  if (
    (newGains.includes("alarms") || newGains.includes("cameras")) &&
    !ctx.read<CombatState>("combat").active
  ) {
    const alertLoc = resolveAlertLocation(ctx);
    const alertLevel = currentAlert(ctx.read<StealthState>("stealth"), alertLoc).level;
    if (alertLevel > 0 && alertLevel < ALERT_MAX) {
      emit.push({
        type: "alert",
        delta: -1,
        ...(alertLoc ? { location: alertLoc } : {}),
        reason: `入侵「${command.network}」压制了现场安保系统`,
      });
      notes.push("已接管安保链路，现场警戒度下降");
    }
  }
  return emit.length > 0 ? { ok: true, notes, emit } : { ok: true, notes };
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
    // 躺上冷却潜网椅/冰浴缸可迅速拉低既有积热
    draft.thermal.heat = Math.max(0, draft.thermal.heat - 2);
    draft.thermal.updatedAt = ctx.now;
    return {
      ok: true,
      notes: [
        `躺上${command.chair}接进网络，${command.guard}守着肉身：第 1 层（${DIVE_LAYERS[0]}）`,
      ],
    };
  }
  const dive = draft.dive;
  if (!dive) return fail("没在潜网，先 start");
  if (!draft.deck) return fail("网络接入仓已损坏或离线，无法继续深入潜网，需尽快退出上浮");
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

/** 有卡的人的接入仓与特化：按他身上完好的义体算，和玩家同一套摘要 */
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

/** 检查该 NPC 的网络接入仓是否在当前现场已被瘫痪/烧毁（匹配 id、型号名或「<姓名/外号>…接入仓」写法） */
function npcDeckDisabledAtSite(
  npc: { readonly id: string; readonly name: string; readonly alias?: string | undefined },
  deckId: string,
  deckName: string | null,
  disabled: readonly string[],
): string | undefined {
  if (disabled.length === 0) return undefined;
  const names = [npc.name, npc.alias, npc.id].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  for (const item of disabled) {
    if (item === deckId || (deckName && item === deckName)) return item;
    const mentionsNpc = names.some((n) => item.includes(n));
    if (
      mentionsNpc &&
      (item.includes(deckId) ||
        (deckName !== null && item.includes(deckName)) ||
        /(?:接入仓|网络接入|cyberdeck|deck)/i.test(item))
    ) {
      return item;
    }
  }
  return undefined;
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
  const { deck, deckName } = npcDeckOf(filledBody(npc.body).cyberware, ctx.data);
  if (!deck) return fail(`${npc.name} 没装网络接入仓，放不了快速破解：照他的装备和义体换个打法`);
  const siteKey = ctx.read<WorldClockState>("world").location ?? "unlocated";
  const disabledChrome =
    ctx.read<TensionState>("tension").sites[siteKey]?.disabledEnemyChrome ?? [];
  const disabledHit = npcDeckDisabledAtSite(npc, deck, deckName, disabledChrome);
  if (disabledHit) {
    return fail(`${npc.name} 的接入仓已在现场受损瘫痪（${disabledHit}），修复前放不了快速破解`);
  }
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
      type: "health.hit",
      tier: ruling.harm,
      part: "head",
      source: "injury",
      injuryId: `npcHack:${ruling.id}`,
      reason: `${npc.name}的快速破解「${def.name}」`,
    });
  } else if (harmful) {
    notes.push("没有确认神经损伤，不登记伤势");
  }
  return { ok: true, notes, emit };
}
