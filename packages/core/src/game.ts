/** 新存档的初始世界和给玩家看的状态投影；后端和网页共用 */

import { applyPatches } from "immer";
import { readVoices } from "./gm/block";
import { currentOffers, prepareFor } from "./gm/pending";
import {
  effectiveTurns,
  type LogRecord,
  logVersion,
  restartedScenes,
  voidedSeqs,
} from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import type { SaveMeta } from "./schemas/save";
import { type TurnInput, TurnInputSchema } from "./schemas/turn";
import { credTier } from "./systems/character/apply";
import {
  CharacterStateSchema,
  effectiveAttribute,
  effectiveAttributes,
} from "./systems/character/schema";
import { CombatStateSchema } from "./systems/combat/schema";
import {
  cyberwareCatalog,
  repairCost,
  ripperdocList,
  ripperdocShelf,
  tradeInValue,
} from "./systems/cyberware/apply";
import {
  type CyberwareDef,
  type CyberwareSlot,
  CyberwareStateSchema,
  type RipperdocDebt,
  SLOT_LABELS,
} from "./systems/cyberware/schema";
import {
  ATTRIBUTE_LABELS,
  type Attribute,
  DiceStateSchema,
  OPPONENT_TIERS,
} from "./systems/dice/schema";
import { EconomyStateSchema, RARITY_LABELS } from "./systems/economy/schema";
import { CONDITION_LABELS, woundTag } from "./systems/health/apply";
import { HealthStateSchema, LIMB_LABELS } from "./systems/health/schema";
import { shownStars } from "./systems/heat/apply";
import { EVENT_LABELS, HEAT_DECAY_MINUTES, HeatStateSchema } from "./systems/heat/schema";
import { humanityCap, humanityStage, STAGE_LABELS } from "./systems/humanity/apply";
import { HUMANITY_MAX, HumanityStateSchema } from "./systems/humanity/schema";
import { itemCatalog, sellValue, shopList, shopShelf } from "./systems/inventory/apply";
import {
  CLOTHING_SLOT_LABELS,
  ClothingSlotSchema,
  type InventoryState,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  MOD_SLOT_LABELS,
  ModSlotSchema,
  WEAPON_CATEGORY_LABELS,
} from "./systems/inventory/schema";
import { isOpen, JOB_STATUS_LABELS, maxRisk, riskCap } from "./systems/jobs/apply";
import { JobsStateSchema } from "./systems/jobs/schema";
import { onStage } from "./systems/npc/prompt";
import { type NpcCard, NpcStateSchema } from "./systems/npc/schema";
import { registry } from "./systems/registry";
import { formatGameTime, PERIOD_LABELS, periodOf } from "./systems/world/apply";
import { type LocationDef, locationCatalog, WorldClockStateSchema } from "./systems/world/schema";

/** 状态接口最多带最近这么多轮的正文；更早的按需翻页 */
export const VIEW_TURNS = 50;

/** 新存档要放进世界的静态内容（content 包），例如原作人物卡 */
export interface GameContent {
  readonly npcs?: readonly (NpcCard & { readonly affinity?: number | undefined })[];
  /** 物品表；开局装备要用它结算 */
  readonly items?: readonly ItemDef[];
  /** 义体表；开局自带的义体要用它结算 */
  readonly cyberware?: readonly CyberwareDef[];
  /** 中间人；trust 不写时从 10 起步 */
  readonly fixers?: readonly {
    readonly id: string;
    readonly name: string;
    readonly trust?: number;
  }[];
  /** 常用地点的中文名 */
  readonly locations?: readonly LocationDef[];
  /** 可选的开场；存档的 meta.opening 记着用的是哪一个 */
  readonly openings?: readonly GameOpening[];
  /** 按出身和经历发的开局行装；存档的 meta.loadouts 记着发了哪几套 */
  readonly loadouts?: readonly Loadout[];
}

/** 开场：从哪里开始、身上带什么、眼下有什么活 */
export interface GameOpening {
  readonly id: string;
  readonly title: string;
  /** 开场地点 id */
  readonly location: string;
  /** 只给模型看的开场处境和钩子；故事还没开始时放进提示词 */
  readonly premise: string;
  /** 开局装备：先放进背包，标了 equip 的再装上 */
  readonly gear: readonly {
    readonly id: string;
    readonly equip?: boolean;
    readonly slot?: number;
  }[];
  /** 开局就有的期限，从开场时间往后算 */
  readonly deadlines: readonly {
    readonly id: string;
    readonly label: string;
    readonly afterMinutes: number;
  }[];
  /** 旧存档还在用、新存档不再提供的开场 */
  readonly hidden?: boolean;
  /** 开局身上的欧元 */
  readonly eddies?: number;
  /** 开局自带的义体 id，不扣钱 */
  readonly cyberware?: readonly string[];
  /** 开局就接下的委托，期限从开场时间往后算 */
  readonly jobs?: readonly OpeningJob[];
}

/** 开局行装：按出身发一整套，再按经历补几样；有行装的存档不再用开场自带的装备、欧元和义体 */
export interface Loadout {
  readonly id: string;
  readonly label: string;
  /** origin：出身的整套行装，只取一套；background：经历附带的东西，可以叠加 */
  readonly kind: "origin" | "background";
  /** origin 看角色卡的出身，background 还看过往和本事；出现这些词就用这一套 */
  readonly keywords: readonly string[];
  readonly gear: GameOpening["gear"];
  readonly eddies?: number;
  readonly cyberware?: readonly string[];
}

/** 建档时按角色卡挑行装：出身里最后出现关键词的那一套（中文的中心词在后，“在公司打过零工的街头小子”是街头小子），
 * 没有就用 fallback；经历附带的可以有好几套 */
export function pickLoadouts(
  card: { readonly origin: string; readonly past?: string; readonly skills?: string },
  loadouts: readonly Loadout[],
  fallback: string,
): string[] {
  const at = (text: string, l: Loadout) => {
    const hits = l.keywords
      .map((k) => text.toLowerCase().lastIndexOf(k.toLowerCase()))
      .filter((i) => i >= 0);
    return hits.length === 0 ? -1 : Math.max(...hits);
  };
  const origins = loadouts
    .filter((l) => l.kind === "origin")
    .map((l) => [l, at(card.origin, l)] as const)
    .filter(([, i]) => i >= 0)
    .sort((a, b) => b[1] - a[1]);
  const story = [card.origin, card.past ?? "", card.skills ?? ""].join("\n");
  const extras = loadouts.filter((l) => l.kind === "background" && at(story, l) >= 0);
  return [origins[0]?.[0].id ?? fallback, ...extras.map((l) => l.id)];
}

export interface OpeningJob {
  readonly id: string;
  readonly title: string;
  readonly fixer?: string;
  readonly client: string;
  readonly location?: string;
  readonly risk: number;
  readonly reward: number;
  readonly conflict: string;
  readonly twist?: string;
  readonly afterMinutes: number;
}

/** 开局发的东西：有行装时用行装，旧存档和没选行装时用开场自带的 */
interface Kit {
  readonly gear: GameOpening["gear"];
  readonly eddies?: number | undefined;
  readonly cyberware?: readonly string[] | undefined;
}

function mergeKits(loadouts: readonly Loadout[]): Kit {
  return {
    gear: loadouts.flatMap((l) => l.gear),
    eddies: loadouts.reduce((sum, l) => sum + (l.eddies ?? 0), 0),
    cyberware: [...new Set(loadouts.flatMap((l) => l.cyberware ?? []))],
  };
}

function openingCommands(opening: GameOpening, start: number, kit: Kit = opening): unknown[] {
  const reason = `开局：${opening.title}`;
  return [
    ...kit.gear.map((g) => ({ type: "item", action: "gain", id: g.id, reason })),
    ...kit.gear
      .filter((g) => g.equip)
      .map((g) => ({
        type: "item",
        action: "equip",
        id: g.id,
        reason,
        ...(g.slot === undefined ? {} : { slot: g.slot }),
      })),
    ...(kit.cyberware ?? []).map((id) => ({ type: "cyberware.install", id })),
    ...(kit.eddies ? [{ type: "money", delta: kit.eddies, reason }] : []),
    ...(opening.jobs ?? []).flatMap(({ afterMinutes, ...job }) => [
      { type: "jobOffer", ...job, due: formatGameTime(start + afterMinutes) },
      { type: "jobAccept", id: job.id },
    ]),
    ...opening.deadlines.map((d) => ({
      type: "deadline",
      action: "add",
      id: d.id,
      label: d.label,
      due: formatGameTime(start + d.afterMinutes),
    })),
  ];
}

const setupRng = { roll: () => 1 };

/** 新存档的世界：按存档的开场时间和难度模式初始化，写入玩家角色和原作人物卡 */
export function newGameWorld(
  meta: Pick<SaveMeta, "startTime" | "difficulty"> &
    Partial<Pick<SaveMeta, "character" | "opening" | "loadouts" | "board">>,
  content: GameContent = {},
): WorldState {
  const opening =
    meta.opening === undefined ? undefined : content.openings?.find((o) => o.id === meta.opening);
  if (meta.opening !== undefined && !opening) {
    throw new Error(`内容包里没有开场 ${meta.opening}`);
  }
  const loadouts = (meta.loadouts ?? []).map((id) => {
    const found = content.loadouts?.find((l) => l.id === id);
    if (!found) throw new Error(`内容包里没有开局行装 ${id}`);
    return found;
  });
  const base = registry.initialWorld(meta.startTime);
  const clock = WorldClockStateSchema.parse(base.slices.world);
  const world: WorldState = {
    ...base,
    slices: {
      ...base.slices,
      dice: DiceStateSchema.parse({ mode: meta.difficulty }),
      world: {
        ...clock,
        location: opening?.location ?? clock.location,
        sceneStartedAt: meta.startTime,
      },
    },
  };
  const kit = opening && (loadouts.length > 0 ? mergeKits(loadouts) : opening);
  // 主板的义体在开局行装之后装：同一部位的会换下行装里的那件
  const boardCyberware = (meta.board?.cyberware ?? []).filter(
    (id) => !(kit?.cyberware ?? []).includes(id),
  );
  const commands: unknown[] = [
    ...(meta.character ? [{ type: "character.set", ...meta.character }] : []),
    // 耐受要在装任何义体之前写进去，人性消耗才按它折算
    ...(meta.board ? [{ type: "humanity.setTolerance", tolerance: meta.board.tolerance }] : []),
    ...(content.npcs ?? []).map((card) => ({ type: "npc.seed", ...card })),
    ...(meta.board?.people ?? [])
      .filter((p) => !(content.npcs ?? []).some((c) => c.id === p.id || c.name === p.name))
      .map((p) => ({ type: "npc.seed", ...p })),
    ...(content.fixers ?? []).map((f) => ({ type: "jobs.seedFixer", ...f })),
    ...(opening && kit ? openingCommands(opening, meta.startTime, kit) : []),
    ...boardCyberware.map((id) => ({ type: "cyberware.install", id })),
  ];
  if (commands.length === 0) return world;
  const parsed = commands.map((raw) => {
    const result = registry.parseInternal(raw);
    if (!result.ok) throw new Error(`开局内容不合格：${result.error}`);
    return result.command;
  });
  const applied = registry.applyCommands(world, parsed, {
    rng: setupRng,
    data: {
      ...(content.items ? { items: content.items } : {}),
      ...(content.cyberware ? { cyberware: content.cyberware } : {}),
    },
  });
  for (const { command, result } of applied.results) {
    if (!result.ok) throw new Error(`开局的 ${command.type} 没有生效：${result.reason}`);
  }
  return applied.world;
}

/** 义体的属性加成，例如“反应 +2”；没有时是空字符串 */
function bonusText(def: CyberwareDef): string {
  return [
    ...Object.entries(def.attributes).map(([a, n]) => `${ATTRIBUTE_LABELS[a as Attribute]} +${n}`),
    ...(def.armor ? ["受伤降一档"] : []),
  ].join("、");
}

function ripperdocView(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
  streetCred: number,
  installed: readonly { readonly id: string; readonly slot: CyberwareSlot }[],
  parts: ReadonlyMap<string, CyberwareDef>,
  debts: readonly RipperdocDebt[],
  broken: readonly string[],
) {
  const doc =
    location === null ? undefined : ripperdocList(data).find((d) => d.location === location);
  if (!doc) return null;
  const debt = debts.find((d) => d.doc === doc.id);
  return {
    id: doc.id,
    name: doc.name,
    note: doc.note,
    blackMarket: doc.blackMarket,
    /** 最多肯赊多少；0 是不赊账 */
    credit: doc.credit,
    /** 欠这位医生的钱 */
    debt: debt ? { amount: debt.amount, due: formatGameTime(debt.due) } : null,
    /** 卸下装着的义体时回收多少，按义体 id */
    buyback: Object.fromEntries(
      installed.map((c) => {
        const def = parts.get(c.id);
        return [c.id, def ? tradeInValue(def) : 0];
      }),
    ) as Readonly<Record<string, number>>,
    /** 打坏的义体修好要多少，按义体 id；没坏的不列 */
    repair: Object.fromEntries(
      installed.flatMap((c) => {
        const def = parts.get(c.id);
        return def && broken.includes(c.id) ? [[c.id, repairCost(def)]] : [];
      }),
    ) as Readonly<Record<string, number>>,
    shelf: ripperdocShelf(doc, parts, streetCred, installed).map((item) => ({
      id: item.def.id,
      name: item.def.name,
      slot: item.def.slot,
      slotLabel: SLOT_LABELS[item.def.slot],
      rarity: item.def.rarity,
      rarityLabel: RARITY_LABELS[item.def.rarity],
      price: item.price,
      tradeIn: item.tradeIn,
      net: item.net,
      humanityCost: item.def.humanityCost,
      ability: item.def.ability,
      bonusText: bonusText(item.def),
      locked: item.locked,
      installed: item.installed,
      replaces: item.replaces?.name ?? null,
    })),
  };
}

const CLOTHING_SLOTS = ClothingSlotSchema.options;
const MOD_SLOTS = ModSlotSchema.options;

/** 当前地点开着的商店：货架按武器类别或物品种类分组；背包里的东西标出回收价 */
function shopsView(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
  streetCred: number,
  inventory: InventoryState,
) {
  if (location === null || data.items === undefined) return [];
  const catalog = itemCatalog(data);
  const here = shopList(data).filter((s) => s.location === location);
  if (here.length === 0) return [];
  const sell = Object.entries(inventory.backpack).flatMap(([id, count]) => {
    const def = catalog.get(id);
    return def ? [{ id, name: def.name, count, value: sellValue(def) }] : [];
  });
  return here.map((shop) => ({
    id: shop.id,
    name: shop.name,
    keeper: shop.keeper,
    note: shop.note,
    blackMarket: shop.blackMarket,
    shelf: shopShelf(shop, catalog, streetCred).map(({ def, price, locked }) => ({
      id: def.id,
      name: def.name,
      group:
        def.kind === "weapon" && def.category
          ? WEAPON_CATEGORY_LABELS[def.category]
          : ITEM_KIND_LABELS[def.kind],
      rarityLabel: def.rarity ? RARITY_LABELS[def.rarity] : null,
      price,
      ability: def.ability ?? null,
      locked,
    })),
    /** 背包里的东西卖给这家店给多少；0 是不收 */
    sell,
  }));
}

/** 旧快照里没有后来加的系统和字段：缺的系统用初始值，缺的字段用 schema 默认值补上 */
export function withAllSlices(world: WorldState): WorldState {
  const base = registry.initialWorld(world.time);
  const slices: Record<string, unknown> = { ...world.slices };
  for (const system of registry.order) {
    const raw = slices[system.id];
    if (raw === undefined) {
      slices[system.id] = base.slices[system.id];
      continue;
    }
    // 后来加的字段按 schema 的默认值补上；旧字段原样保留
    const parsed = system.state.safeParse(raw);
    if (parsed.success && typeof raw === "object" && raw !== null) {
      slices[system.id] = { ...raw, ...(parsed.data as object) };
    }
  }
  return { ...world, slices };
}

/**
 * 当前场景从哪条记录开始：最后一次换场景之后的第一条记录。
 * initial 是新存档的初始世界；整局都在第一个场景里时是 0
 */
export function sceneStartSeq(initial: WorldState, records: readonly LogRecord[]): number {
  const voided = voidedSeqs(records);
  const sceneOf = (w: WorldState) => (w.slices.world as { scene?: number } | undefined)?.scene ?? 0;
  let world = initial;
  let scene = sceneOf(world);
  let start = 0;
  for (const record of records) {
    if (record.kind === "void" || record.kind === "check" || voided.has(record.seq)) continue;
    world = applyPatches(world, record.patches);
    const now = sceneOf(world);
    if (now !== scene) {
      scene = now;
      start = record.seq + 1;
    }
  }
  return start;
}

/** 状态接口带上的已结束委托，最近的优先 */
export const JOBS_CLOSED_SHOWN = 5;

function turnInput(raw: unknown): TurnInput {
  const parsed = TurnInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : { text: String(raw) };
}

/** 最近一轮留给玩家的选项和待确认的检定；成功率按当前属性现算 */
function projectOffers(world: WorldState, records: readonly LogRecord[]) {
  const offers = currentOffers(records);
  const character = CharacterStateSchema.parse(world.slices.character);
  const checks = offers.checks.flatMap((offer) => {
    const prepared = prepareFor(world, offer.spec);
    if (!prepared.ok) return [];
    const { spec } = offer;
    const { check } = prepared;
    return [
      {
        id: offer.id,
        label: offer.label,
        attribute: spec.attribute,
        attributeLabel: ATTRIBUTE_LABELS[spec.attribute],
        attributeValue: check.attributeValue,
        tierLabel: OPPONENT_TIERS[spec.tier].label,
        /** 档位给的基础难度值；最终难度值 dv = 基础值 + 修正（封顶后）+ 难度模式 */
        baseDv: spec.dv,
        dv: check.dv,
        modeDv: check.modeDv,
        /** 检定值：属性 + 加成 − 减值（封顶后） */
        modifier: check.modifier,
        /** 逐条来源；raw 是封顶前的合计，和 total 不同时界面标“已封顶” */
        bonuses: check.bonus,
        penalties: check.penalty,
        dvMods: check.dvMods,
        capped:
          check.bonus.raw !== check.bonus.total ||
          check.penalty.raw !== check.penalty.total ||
          check.dvMods.raw !== check.dvMods.total,
        chance: check.chance,
        success: spec.success,
        failure: spec.failure,
        damage: spec.damage ?? null,
        rolled: offers.rolled?.offer.id === offer.id,
      },
    ];
  });
  const seq = offers.turn?.seq;
  return {
    read: offers.turn?.read ?? null,
    choices: offers.choices.map((choice, i) => ({
      text: choice.text,
      gate: choice.gate
        ? {
            ...choice.gate,
            attributeLabel: ATTRIBUTE_LABELS[choice.gate.attribute],
            met: effectiveAttribute(character, choice.gate.attribute) >= choice.gate.value,
          }
        : null,
      checkId: choice.check && seq !== undefined ? `${seq}.${i + 1}` : null,
      /** 专属选项的来源，例如“过往：荒坂前员工” */
      source: choice.source ?? null,
    })),
    checks,
    /** 已经掷过骰的检定 id；这时只能确认它 */
    rolled: offers.rolled?.offer.id ?? null,
  };
}

const CJK = /[\u3400-\u9fff]/;

/** 物品和地点的中文名；表外的物品用 id，表外的地点只有本身是中文时才当名字 */
function displayNames(
  data: Readonly<Record<string, unknown>>,
  inventory: InventoryState,
  location: string | null,
) {
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  const ids = new Set([
    ...inventory.weapons.filter((w): w is string => w !== null),
    ...(inventory.healing ? [inventory.healing.id] : []),
    ...(inventory.grenade ? [inventory.grenade.id] : []),
    ...Object.keys(inventory.backpack),
    ...Object.values(inventory.clothing),
  ]);
  const place = location === null ? undefined : locationCatalog(data).get(location);
  return {
    items: Object.fromEntries([...ids].map((id) => [id, items.get(id)?.name ?? id])),
    location: place?.name ?? (location !== null && CJK.test(location) ? location : null),
    district: place?.district ?? null,
  };
}

/**
 * 玩家能看到的状态。只放界面要显示的东西：
 * 去重用的已结算事件、已用检定 id、换装防刷的次数记录、被丢弃的指令都不出现
 */
export function projectState(
  world: WorldState,
  records: readonly LogRecord[],
  /** 静态数据表；带物品表和地点表时给出中文名 */
  data: Readonly<Record<string, unknown>> = {},
) {
  const dice = DiceStateSchema.parse(world.slices.dice);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const health = HealthStateSchema.parse(world.slices.health);
  const humanity = HumanityStateSchema.parse(world.slices.humanity);
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const combat = CombatStateSchema.parse(world.slices.combat);
  const character = CharacterStateSchema.parse(world.slices.character);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const economy = EconomyStateSchema.parse(world.slices.economy);
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const { installed, debts } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  // 旧快照里没有热度系统
  const heat = world.slices.heat === undefined ? null : HeatStateSchema.parse(world.slices.heat);
  const parts = cyberwareCatalog(data);
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  const period = periodOf(world.time);
  const humanityLevel = humanityStage(humanity.current);
  const turns = effectiveTurns(records);
  const active = combat.active;

  return {
    version: logVersion(records),
    difficulty: dice.mode,
    /** 角色死了时不为 null：夜之城每个场景能从开头重来一次，其他难度死了就结束 */
    death:
      health.condition === "dead"
        ? { canRestart: dice.mode === "nightCity" && !restartedScenes(records).has(clock.scene) }
        : null,
    /** 整局重来过几个场景，履历里记着 */
    restarts: restartedScenes(records).size,
    character: {
      name: character.name,
      brief: character.brief,
      /** 检定用的属性，已经算上义体加成 */
      attributes: effectiveAttributes(character),
      /** 义体加成：侧栏标出来 */
      bonuses: character.bonuses,
      streetCred: character.streetCred,
      credTier: credTier(character.streetCred).label,
      credWorld: credTier(character.streetCred).world,
      /** 攒着半级声望，再得半级就升级 */
      credHalf: character.credHalf,
      attributePoints: character.attributePoints,
      /** 主板上的模块和联动；没用主板的角色是空的 */
      traits: character.traits,
    },
    time: {
      minutes: world.time,
      text: formatGameTime(world.time),
      period,
      periodLabel: PERIOD_LABELS[period],
    },
    location: clock.location,
    /** 界面显示用的中文名，查不到时为 id 或 null */
    names: displayNames(data, inventory, clock.location),
    scene: clock.scene,
    health: {
      hp: health.hp,
      max: health.max,
      condition: health.condition,
      conditionLabel: CONDITION_LABELS[health.condition],
      wound: woundTag(health),
      /** 断了还没装义肢的部位 */
      lostLimbs: health.lostLimbs.map((l) => ({ id: l, label: LIMB_LABELS[l] })),
    },
    humanity: {
      current: humanity.current,
      cap: humanityCap(humanity),
      max: HUMANITY_MAX,
      stage: humanityLevel,
      stageLabel: STAGE_LABELS[humanityLevel],
    },
    inventory: {
      weapons: inventory.weapons,
      active: inventory.active,
      healing: inventory.healing,
      grenade: inventory.grenade,
      backpack: inventory.backpack,
      /** 穿着的服装，按格子顺序；没穿的格子不列 */
      clothing: CLOTHING_SLOTS.flatMap((slot) => {
        const id = inventory.clothing[slot];
        return id === undefined ? [] : [{ slot, label: CLOTHING_SLOT_LABELS[slot], id }];
      }),
      /** 存下的整套外观，按格子顺序；没存过时为空 */
      outfit: CLOTHING_SLOTS.flatMap((slot) => {
        const id = inventory.outfit[slot];
        return id === undefined ? [] : [{ slot, label: CLOTHING_SLOT_LABELS[slot], id }];
      }),
      /** 背包里每件东西能装到哪：weapon 武器格、quick 快捷栏、clothing 服装格；不能装的不列 */
      equipTo: Object.fromEntries(
        Object.keys(inventory.backpack).flatMap((id) => {
          const kind = items.get(id)?.kind;
          const to =
            kind === "weapon"
              ? "weapon"
              : kind === "healing" || kind === "grenade"
                ? "quick"
                : kind === "clothing"
                  ? "clothing"
                  : null;
          return to ? [[id, to]] : [];
        }),
      ) as Readonly<Record<string, "weapon" | "quick" | "clothing">>,
      /** 武器栏里带专属内心声音的不朽武器 */
      iconicVoices: inventory.weapons.flatMap((w) => {
        const def = w === null ? undefined : items.get(w);
        return def?.iconic && def.voice !== undefined
          ? [{ id: def.id, name: def.name, voice: def.voice }]
          : [];
      }),
      /** 武器上装着的改装件：武器 id → 按位置顺序；没装的武器不列 */
      mods: Object.fromEntries(
        Object.entries(inventory.mods).map(([weapon, fitted]) => [
          weapon,
          MOD_SLOTS.flatMap((slot) => {
            const id = fitted[slot];
            return id === undefined ? [] : [{ slot, label: MOD_SLOT_LABELS[slot], id }];
          }),
        ]),
      ) as Readonly<Record<string, readonly { slot: string; label: string; id: string }[]>>,
      /** 背包里的改装件能装到哪几把身上的武器（武器格和背包里的），按武器格在前 */
      modTargets: Object.fromEntries(
        Object.keys(inventory.backpack).flatMap((id) => {
          const fits = items.get(id)?.modFits;
          if (fits === undefined) return [];
          const owned = [
            ...new Set([
              ...inventory.weapons.filter((w): w is string => w !== null),
              ...Object.keys(inventory.backpack),
            ]),
          ];
          const targets = owned.filter((w) => {
            const category = items.get(w)?.category;
            return (
              items.get(w)?.kind === "weapon" && category !== undefined && fits.includes(category)
            );
          });
          return targets.length > 0 ? [[id, targets]] : [];
        }),
      ) as Readonly<Record<string, readonly string[]>>,
    },
    /** 装着的义体，按装上的先后 */
    cyberware: installed.map((c) => {
      const def = parts.get(c.id);
      return {
        id: c.id,
        name: def?.name ?? c.id,
        slot: c.slot,
        slotLabel: SLOT_LABELS[c.slot],
        rarityLabel: def ? RARITY_LABELS[def.rarity] : null,
        ability: def?.ability ?? null,
        bonusText: def ? bonusText(def) : "",
        /** 被打坏了：修好前失去能力 */
        broken: health.brokenChrome.includes(c.id),
      };
    }),
    /** 当前地点开着的义体医生；不在诊所时是 null */
    ripperdoc: ripperdocView(
      data,
      clock.location,
      character.streetCred,
      installed,
      parts,
      debts,
      health.brokenChrome,
    ),
    /** 欠义体医生的钱 */
    /** 当前地点开着的商店 */
    shops: shopsView(data, clock.location, character.streetCred, inventory),
    ripperdocDebts: debts.map((d) => ({
      docName: d.docName,
      amount: d.amount,
      due: formatGameTime(d.due),
    })),
    combat: {
      active: active && {
        /** 第几次交锋，从 1 起 */
        moment: active.current + 1,
        moments: active.moments,
        defeat: active.defeat,
        enemies: active.enemies,
        /** 有卡敌人：没扫描过的，界面不显示血条 */
        foes: (active.foes ?? []).map((f) => ({
          npc: f.npc,
          name: f.name,
          tier: f.tier,
          tierLabel: OPPONENT_TIERS[f.tier].label,
          need: f.need,
          hits: f.hits,
          scanned: f.scanned,
          down: f.hits >= f.need,
        })),
        results: active.results,
        /** 濒死时还剩几次交锋结束前要被救回；不在濒死时为 null */
        dyingMomentsLeft:
          active.dyingUntil === null ? null : active.dyingUntil - active.current + 1,
      },
      last: combat.last,
    },
    /** 见过的人；诉求、底线和秘密只给模型看，不在这里 */
    npcs: Object.values(npcs.npcs)
      .filter((n) => n.met)
      .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
      .map((n) => ({
        id: n.id,
        name: n.name,
        alias: n.alias ?? null,
        pronoun: n.pronoun,
        role: n.role,
        look: n.look,
        affinity: n.affinity,
        alive: n.alive,
        here: onStage(n, stage),
        memories: n.memories,
      })),
    money: { eddies: economy.eddies },
    /** 警方热度：整星，另标有没有攒着半星；自然下降还要多久（分钟） */
    heat: {
      stars: shownStars(heat?.stars ?? 0),
      half: (heat?.stars ?? 0) % 1 !== 0,
      lastSeen: heat?.lastSeenAt == null ? null : formatGameTime(heat.lastSeenAt),
      decayIn:
        heat && heat.stars > 0 && heat.decayedAt !== null
          ? Math.max(0, heat.decayedAt + HEAT_DECAY_MINUTES - world.time)
          : null,
      recent: (heat?.recent ?? [])
        .slice(-3)
        .reverse()
        .map((e) => ({
          at: formatGameTime(e.at),
          label: EVENT_LABELS[e.kind],
          delta: e.delta,
          reason: e.reason,
        })),
    },
    /** 委托和中间人；隐藏的转折只给模型看，不在这里 */
    jobs: {
      fixers: Object.values(jobs.fixers).map((f) => ({
        id: f.id,
        name: f.name,
        trust: f.trust,
        maxRisk: maxRisk(f, character.streetCred),
        cappedBy: riskCap(f, character.streetCred).by,
        capHint: riskCap(f, character.streetCred).hint,
      })),
      list: [
        ...jobs.jobs.filter(isOpen),
        ...jobs.jobs.filter((j) => !isOpen(j)).slice(-JOBS_CLOSED_SHOWN),
      ].map((j) => ({
        id: j.id,
        title: j.title,
        fixer: j.fixer === null ? null : (jobs.fixers[j.fixer]?.name ?? j.fixer),
        client: j.client,
        location: j.location,
        risk: j.risk,
        reward: j.reward,
        due: j.due === null ? null : formatGameTime(j.due),
        /** 离期限还有多少分钟；已过期为负 */
        dueIn: j.due === null ? null : j.due - world.time,
        overdue: isOpen(j) && j.due !== null && j.due <= world.time,
        status: j.status,
        statusLabel: JOB_STATUS_LABELS[j.status],
        open: isOpen(j),
        notes: j.notes,
        paid: j.paid,
        summary: j.summary,
        /** 结算卡：声望按级、信任度变化、接单以来的人性变化 */
        settlement:
          j.settlement === null
            ? null
            : {
                streetCred: j.settlement.credHalves / 2,
                trust: j.settlement.trust,
                humanity: j.settlement.humanity,
              },
      })),
    },
    deadlines: clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        due: formatGameTime(d.due),
        overdue: d.due <= world.time,
      })),
    offers: projectOffers(world, records),
    totalTurns: turns.length,
    turns: turns.slice(-VIEW_TURNS).map((t) => ({
      seq: t.seq,
      at: t.at,
      input: turnInput(t.input),
      text: t.text,
      voices: readVoices(t.voices),
      dice: t.dice,
      /** 被丢弃的指令条数；大于 0 时界面提示“本轮有数值没结算” */
      dropped: t.dropped.length,
    })),
  };
}

export type PlayerView = ReturnType<typeof projectState>;
