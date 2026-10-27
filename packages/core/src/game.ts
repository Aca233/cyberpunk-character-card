/** 新存档的初始世界和给玩家看的状态投影；后端和网页共用 */

import { applyPatches } from "immer";
import {
  effectiveTurns,
  type LogRecord,
  logVersion,
  restartedScenes,
  voidedSeqs,
} from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import { chronicleEntries } from "./legends";
import { readVoices } from "./narrator/block";
import { currentOffers, prepareFor } from "./narrator/pending";
import type { SaveMeta } from "./schemas/save";
import { type TurnInput, TurnInputSchema } from "./schemas/turn";
import { ArcsStateSchema, arcCatalog, CONCERN_STATUS_LABELS } from "./systems/arcs";
import type { braindanceView } from "./systems/braindance";
import type { characterView } from "./systems/character";
import { credTier } from "./systems/character/apply";
import {
  CharacterStateSchema,
  effectiveAttribute,
  effectiveAttributes,
} from "./systems/character/schema";
import { ChronicleStateSchema, ENDING_LABELS } from "./systems/chronicle/schema";
import type { bulletinsView } from "./systems/city";
import type { combatView } from "./systems/combat";
import { bonusText, type cyberwareView } from "./systems/cyberware";
import {
  cyberwareCatalog,
  repairCost,
  ripperdocList,
  ripperdocShelf,
  tradeInValue,
} from "./systems/cyberware/apply";
import {
  BOOST_SLOTS,
  BOOST_WINDOW,
  type CyberwareDef,
  type CyberwareSlot,
  CyberwareStateSchema,
  type RipperdocDebt,
  SLOT_LABELS,
} from "./systems/cyberware/schema";
import {
  ATTRIBUTE_LABELS,
  DiceStateSchema,
  type Difficulty,
  OPPONENT_TIERS,
} from "./systems/dice/schema";
import { keeperOf, type moneyView, RARITY_LABELS } from "./systems/economy";
import type { factionsView } from "./systems/factions";
import type { hackingView, QuickhackDef } from "./systems/hacking";
import { HealthStateSchema, type healthView, LIMB_LABELS, woundTag } from "./systems/health";
import { shownStars } from "./systems/heat/apply";
import { EVENT_LABELS, HEAT_DECAY_MINUTES, HeatStateSchema } from "./systems/heat/schema";
import type { humanityView } from "./systems/humanity";
import type { inventoryView } from "./systems/inventory";
import {
  currentStock,
  itemCatalog,
  restockDue,
  sellValue,
  shopList,
  shopShelf,
} from "./systems/inventory/apply";
import {
  ClothingSlotSchema,
  type InventoryState,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  WEAPON_CATEGORY_LABELS,
} from "./systems/inventory/schema";
import { isOpen, JOB_STATUS_LABELS, maxRisk, riskCap } from "./systems/jobs/apply";
import { JOB_KIND_LABELS, JobsStateSchema } from "./systems/jobs/schema";
import { IMPORTANCE_LABELS, MemoryStateSchema } from "./systems/memory/schema";
import type { ncpdView } from "./systems/ncpd";
import {
  NEMESIS_CRED_HALVES,
  NEMESIS_END_LABELS,
  NEMESIS_STYLE_LABELS,
  NemesisStateSchema,
} from "./systems/nemesis";
import { deathKnown } from "./systems/npc/apply";
import { attributeSum, bodyView } from "./systems/npc/body";
import { onStage } from "./systems/npc/prompt";
import {
  KNOWN_SOURCE_LABELS,
  LEDGER_KIND_LABELS,
  type NpcCard,
  NpcStateSchema,
} from "./systems/npc/schema";
import { PhoneStateSchema } from "./systems/phone/schema";
import { blackoutTurns, lostControlOf, type psychosisView } from "./systems/psychosis/apply";
import { registry } from "./systems/registry";
import type { HomeDef, safehouseView } from "./systems/safehouse";
import type { sidegigsView } from "./systems/sidegigs/apply";
import type { squadView } from "./systems/squad/apply";
import type { stealthView } from "./systems/stealth";
import type { traumaView } from "./systems/trauma";
import {
  planTrip,
  type TravelRequest,
  type travelView,
  tripWorldOf,
  type VehicleDef,
} from "./systems/travel";
import type { worldView } from "./systems/world";
import { formatGameTime } from "./systems/world/apply";
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
  /** 快速破解表；开局自带的程序要用它结算 */
  readonly quickhacks?: readonly QuickhackDef[];
  /** 车型表；开局送车时要用 */
  readonly vehicles?: readonly VehicleDef[];
  /** 中间人；好感记在同 id 的人物卡上 */
  readonly fixers?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  /** 常用地点的中文名 */
  readonly locations?: readonly LocationDef[];
  /** 可选的开场；存档的 meta.opening 记着用的是哪一个 */
  readonly openings?: readonly GameOpening[];
  /** 按出身和经历发的开局行装；存档的 meta.loadouts 记着发了哪几套 */
  readonly loadouts?: readonly Loadout[];
  /** 开局住所，按出身给 */
  readonly homes?: readonly HomeDef[];
  /** 开场没写 cast 时种哪些人物卡和中间人（旧存档）；都没写就全种 */
  readonly defaultCast?: readonly string[];
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
  /** 这个开场种哪些人物卡和中间人（id）；没写就用内容包的 defaultCast */
  readonly cast?: readonly string[];
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
  /** 装进接入仓的快速破解程序 id；要同时带接入仓 */
  readonly programs?: readonly string[];
  /** 开局名下的车（车型 id） */
  readonly vehicles?: readonly string[];
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
  readonly programs?: readonly string[] | undefined;
  readonly vehicles?: readonly string[] | undefined;
}

function mergeKits(loadouts: readonly Loadout[]): Kit {
  return {
    gear: loadouts.flatMap((l) => l.gear),
    eddies: loadouts.reduce((sum, l) => sum + (l.eddies ?? 0), 0),
    cyberware: [...new Set(loadouts.flatMap((l) => l.cyberware ?? []))],
    programs: [...new Set(loadouts.flatMap((l) => l.programs ?? []))],
    vehicles: loadouts.flatMap((l) => l.vehicles ?? []),
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
    ...(kit.programs ?? []).map((id) => ({ type: "hack", action: "learn", program: id, reason })),
    ...(kit.eddies ? [{ type: "money", delta: kit.eddies, reason }] : []),
    ...(kit.vehicles ?? []).map((model) => ({ type: "vehicle.grant", model, reason })),
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
    Partial<Pick<SaveMeta, "character" | "opening" | "loadouts" | "board" | "legends">>,
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
  const castIds = opening?.cast ?? content.defaultCast;
  const inCast = (id: string) => castIds === undefined || castIds.includes(id);
  const cast = (content.npcs ?? []).filter((c) => inCast(c.id));
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
    ...cast.map((card) => ({ type: "npc.seed", ...card })),
    ...(meta.board?.people ?? [])
      .filter((p) => !cast.some((c) => c.id === p.id || c.name === p.name))
      .map((p) => ({ type: "npc.seed", ...p })),
    ...(content.fixers ?? [])
      .filter((f) => inCast(f.id))
      .map((f) => ({ type: "jobs.seedFixer", ...f })),
    ...(opening && kit ? openingCommands(opening, meta.startTime, kit) : []),
    ...boardCyberware.map((id) => ({ type: "cyberware.install", id })),
    ...homeSeed(content, meta.board?.origin),
    ...(meta.legends && meta.legends.length > 0
      ? [{ type: "chronicle.seedLegends", legends: meta.legends }]
      : []),
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
      ...(content.quickhacks ? { quickhacks: content.quickhacks } : {}),
      ...(content.vehicles ? { vehicles: content.vehicles } : {}),
    },
  });
  for (const { command, result } of applied.results) {
    if (!result.ok) throw new Error(`开局的 ${command.type} 没有生效：${result.reason}`);
  }
  return applied.world;
}

/** 按出身给开局住所；对不上时用 default 那一处 */
function homeSeed(content: GameContent, origin: string | undefined): unknown[] {
  const homes = content.homes ?? [];
  const home = homes.find((h) => h.origin === origin) ?? homes.find((h) => h.origin === "default");
  return home
    ? [{ type: "safehouse.seed", id: home.id, name: home.name, location: home.location }]
    : [];
}

/** 装着、没坏的第一件加速义体；cost 是再开一次扣多少人性 */
export function sandevistanOf(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): {
  readonly id: string;
  readonly name: string;
  readonly slots: number;
  readonly cost: number;
} | null {
  const parts = cyberwareCatalog(data);
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  for (const c of state.installed) {
    const def = parts.get(c.id);
    if (!def?.accelerator || broken.includes(c.id)) continue;
    const last = state.boost;
    const cost = last && world.time - last.lastAt <= BOOST_WINDOW ? last.count + 1 : 1;
    return { id: def.id, name: def.name, slots: BOOST_SLOTS[def.rarity], cost };
  }
  return null;
}

/** 这一轮能不能开斯安威斯坦；能开时返回 null，否则返回原因 */
export function sandevistanBlock(
  world: WorldState,
  records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>>,
): string | null {
  if (currentOffers(records).turn?.clutch !== true) {
    return "现在不是生死瞬间：叙事模型标记了 clutch 才能开斯安威斯坦";
  }
  return sandevistanOf(world, data) ? null : "没装能用的加速义体";
}

function ripperdocView(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
  streetCred: number,
  installed: readonly { readonly id: string; readonly slot: CyberwareSlot }[],
  parts: ReadonlyMap<string, CyberwareDef>,
  debts: readonly RipperdocDebt[],
  broken: readonly string[],
  npcs: Parameters<typeof keeperOf>[1],
) {
  const doc =
    location === null ? undefined : ripperdocList(data).find((d) => d.location === location);
  if (!doc) return null;
  const debt = debts.find((d) => d.doc === doc.id);
  const keeper = keeperOf(doc.keeperNpc, npcs);
  return {
    id: doc.id,
    name: doc.name,
    /** 医生对你的好感；没有人物卡或还没见过是 null */
    affinity: keeper?.affinity ?? null,
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
    shelf: ripperdocShelf(doc, parts, streetCred, installed, keeper).map((item) => ({
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

/** 当前地点开着的商店：货架按武器类别或物品种类分组；背包里的东西标出回收价 */
/** 这一批卖过货时，下次补满的时间写成文字 */
function restockLabel(due: number | null): string | null {
  return due === null ? null : formatGameTime(due);
}

function shopsView(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
  streetCred: number,
  inventory: InventoryState,
  now: number,
  npcs: Parameters<typeof keeperOf>[1],
) {
  if (location === null || data.items === undefined) return [];
  const catalog = itemCatalog(data);
  const here = shopList(data).filter((s) => s.location === location);
  if (here.length === 0) return [];
  const sell = Object.entries(inventory.backpack).flatMap(([id, count]) => {
    const def = catalog.get(id);
    return def ? [{ id, name: def.name, count, value: sellValue(def) }] : [];
  });
  return here.map((shop) => {
    const keeper = keeperOf(shop.keeperNpc, npcs);
    return {
      id: shop.id,
      name: shop.name,
      keeper: shop.keeper,
      /** 店主对你的好感；店主没有人物卡或还没见过是 null */
      keeperAffinity: keeper?.affinity ?? null,
      note: shop.note,
      blackMarket: shop.blackMarket,
      restockAt: restockLabel(restockDue(inventory.shopStock[shop.id], now)),
      shelf: shopShelf(
        shop,
        catalog,
        streetCred,
        currentStock(inventory.shopStock[shop.id], now),
        keeper,
      ).map(({ def, price, locked, left }) => ({
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
        left,
      })),
      /** 背包里的东西卖给这家店给多少；0 是不收 */
      sell,
    };
  });
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
    /** 叙事模型标记了生死瞬间：这一轮可以开斯安威斯坦 */
    clutch: offers.turn?.clutch === true,
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
/** 出身带出来的口音和做派；查不到的出身只写出身 */
const ORIGIN_ACCENTS: Readonly<Record<string, string>> = {
  街头小子: "一口夜之城街头腔，黑话张嘴就来",
  流浪者: "带着荒地口音，说话直来直去",
  公司员工: "一口公司腔，用词客气、句句留余地",
};

/** 别人一眼看得见的义体部位 */
const VISIBLE_CHROME: ReadonlySet<string> = new Set([
  "eyes",
  "integumentary",
  "hands",
  "arms",
  "legs",
]);
/** 装到这么多件，路人会觉得浑身是铬 */
const CHROME_HEAVY = 6;
/** 热度到这么多星，街上算是有悬赏、被通缉 */
const WANTED_STARS = 3;

const WOUND_LOOKS: Readonly<Record<string, string>> = {
  light: "身上带着伤",
  severe: "伤得很重，走路都不稳",
  zero: "浑身是血，随时会倒下",
};

export interface Looks {
  readonly traits: readonly { readonly slot: string; readonly label: string }[];
  readonly streetCred: number;
  readonly clothing: Readonly<Partial<Record<string, string>>>;
  readonly installed: readonly { readonly id: string; readonly slot: string }[];
  readonly lostLimbs: readonly string[];
  readonly wound: string;
  readonly heatStars: number;
}

/** 别人眼里的你：每轮从出身、口音、穿着、看得见的义体、伤势、声望和热度拼一行 */
export function perceivedLine(
  looks: Looks,
  parts: ReadonlyMap<string, { readonly name: string }>,
  items: ReadonlyMap<string, { readonly name: string }>,
): string {
  const bits: string[] = [];
  const origin = looks.traits.find((t) => t.slot === "origin")?.label;
  if (origin) {
    const accent = ORIGIN_ACCENTS[origin];
    bits.push(accent ? `${origin}出身，${accent}` : `${origin}出身`);
  }
  const worn = CLOTHING_SLOTS.flatMap((slot) => {
    const id = looks.clothing[slot];
    return id === undefined ? [] : [items.get(id)?.name ?? id];
  });
  bits.push(worn.length > 0 ? `穿着${worn.join("、")}` : "衣着不起眼");
  const slotLabels = SLOT_LABELS as Readonly<Record<string, string>>;
  const shown = looks.installed
    .filter((c) => VISIBLE_CHROME.has(c.slot))
    .map((c) => `${parts.get(c.id)?.name ?? c.id}（${slotLabels[c.slot] ?? c.slot}）`);
  if (looks.installed.length >= CHROME_HEAVY) {
    bits.push(`浑身是铬${shown.length > 0 ? `，看得见${shown.join("、")}` : ""}`);
  } else if (shown.length > 0) {
    bits.push(`看得见${shown.join("、")}`);
  } else {
    bits.push(looks.installed.length > 0 ? "装的义体都藏在身体里，一眼看不出来" : "看不出装了义体");
  }
  if (looks.lostLimbs.length > 0) {
    const limbLabels = LIMB_LABELS as Readonly<Record<string, string>>;
    bits.push(`少了${looks.lostLimbs.map((l) => limbLabels[l] ?? l).join("、")}`);
  }
  const wound = WOUND_LOOKS[looks.wound];
  if (wound) bits.push(wound);
  bits.push(`街头声望 ${looks.streetCred} 级（${credTier(looks.streetCred).label}）`);
  if (looks.heatStars >= WANTED_STARS) {
    bits.push(`NCPD 通缉中（${looks.heatStars} 星），赏金猎人和眼尖的人认得出`);
  } else if (looks.heatStars > 0) {
    bits.push(`NCPD 在留意（${looks.heatStars} 星）`);
  }
  return bits.join("；");
}

/** 界面上最多列几条消息 */
const PHONE_SHOWN = 20;
/** 记忆面板显示最近几条修改记录 */
const MEMORY_EDITS_SHOWN = 20;

export function projectState(
  world: WorldState,
  records: readonly LogRecord[],
  /** 静态数据表；带物品表和地点表时给出中文名 */
  data: Readonly<Record<string, unknown>> = {},
) {
  const views = registry.project({ world, records, data });
  const clockView = views.clock as ReturnType<typeof worldView>;
  const dice = DiceStateSchema.parse(world.slices.dice);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const health = HealthStateSchema.parse(world.slices.health);
  // 旧存档没有履历系统
  const chronicleState = ChronicleStateSchema.parse(world.slices.chronicle ?? {});
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const character = CharacterStateSchema.parse(world.slices.character);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  // 旧存档没有宿敌系统
  const nemesisState = NemesisStateSchema.parse(world.slices.nemesis ?? {});
  // 旧存档没有心事
  const arcState = ArcsStateSchema.parse(world.slices.arcs ?? {});
  const arcSeeds = arcCatalog(data ?? {});
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  // 旧存档没有消息记录
  const phoneState = PhoneStateSchema.parse(world.slices.phone ?? {});
  const { installed, debts } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  // 旧快照里没有热度系统
  const heat = world.slices.heat === undefined ? null : HeatStateSchema.parse(world.slices.heat);
  const parts = cyberwareCatalog(data);
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  const turns = effectiveTurns(records);

  return {
    version: logVersion(records),
    difficulty: views.difficulty as Difficulty,
    /** 角色死了时不为 null：夜之城每个场景能从开头重来一次，其他难度死了就结束 */
    death:
      health.condition === "dead"
        ? { canRestart: dice.mode === "nightCity" && !restartedScenes(records).has(clock.scene) }
        : null,
    /** 整局重来过几个场景，履历里记着 */
    restarts: restartedScenes(records).size,
    /** 玩家结束了故事（退休或停在这里）；没结束是 null。和死透了一样，之后存档只读 */
    ended: chronicleState.ended && {
      how: chronicleState.ended.how,
      label: ENDING_LABELS[chronicleState.ended.how],
      epitaph: chronicleState.ended.epitaph,
      at: formatGameTime(chronicleState.ended.at),
    },
    /** 履历：叙事模型写的段落、结束的委托、死亡和结束故事，按游戏时间从早到晚 */
    chronicle: chronicleEntries({
      chronicle: chronicleState,
      jobs: jobs.jobs,
      death: health.condition === "dead" ? { at: world.time, location: clock.location } : null,
    }),
    /** 了结了的宿敌：界面按新出现的弹结算卡；旧的在前 */
    nemesesEnded: nemesisState.ended.map((e) => ({
      npc: e.npc,
      name: e.name,
      end: e.end,
      endLabel: NEMESIS_END_LABELS[e.end],
      text: e.text,
      how: e.how,
      since: formatGameTime(e.since),
      at: formatGameTime(e.at),
      /** 了结宿敌给的街头声望（级） */
      cred: NEMESIS_CRED_HALVES / 2,
    })),
    /** 超梦调查：正在查的录像（编辑器用）和查过的几次；旧存档没有超梦系统 */
    braindance: views.braindance as ReturnType<typeof braindanceView>,
    character: views.character as ReturnType<typeof characterView>,
    time: clockView.time,
    /** 天气：按时间、季节和城区算；还没有地点时按市区 */
    weather: clockView.weather,
    location: clockView.location,
    /** 界面显示用的中文名，查不到时为 id 或 null */
    names: displayNames(data, inventory, clock.location),
    scene: clockView.scene,
    health: views.health as ReturnType<typeof healthView>,
    humanity: views.humanity as ReturnType<typeof humanityView>,
    inventory: views.inventory as ReturnType<typeof inventoryView>,
    /** 装着的义体，按装上的先后 */
    cyberware: views.cyberware as ReturnType<typeof cyberwareView>,
    /** 网络接入仓、RAM 和装着的快速破解；没装接入仓是 null */
    hacking: views.hacking as ReturnType<typeof hackingView>,
    /** 地图上的地点和到每个地点的路线；路线面板照这里显示，结算用同一套算法 */
    travel: views.travel as ReturnType<typeof travelView>,
    /** 各势力对玩家的态度，和当前地点是谁的地盘 */
    factions: views.factions as ReturnType<typeof factionsView>,
    /** 扫描器上挂着的 NCPD 警情 */
    ncpd: views.ncpd as ReturnType<typeof ncpdView>,
    /** 创伤小组会籍，和现在叫不叫得来 */
    trauma: views.trauma as ReturnType<typeof traumaView>,
    /** 安全屋、存放箱、后备箱和战利品墙 */
    safehouse: views.safehouse as ReturnType<typeof safehouseView>,
    psychosis: views.psychosis as ReturnType<typeof psychosisView>,
    squad: views.squad as ReturnType<typeof squadView>,
    sidegigs: views.sidegigs as ReturnType<typeof sidegigsView>,
    /** 当前地点开着的义体医生；不在诊所时是 null */
    ripperdoc: ripperdocView(
      data,
      clock.location,
      character.streetCred,
      installed,
      parts,
      debts,
      health.brokenChrome,
      npcs.npcs,
    ),
    /** 欠义体医生的钱 */
    /** 当前地点开着的商店 */
    shops: shopsView(data, clock.location, character.streetCred, inventory, world.time, npcs.npcs),
    ripperdocDebts: debts.map((d) => ({
      docName: d.docName,
      amount: d.amount,
      due: formatGameTime(d.due),
    })),
    combat: views.combat as ReturnType<typeof combatView>,
    /** 当前场景的潜入警戒度 */
    stealth: views.stealth as ReturnType<typeof stealthView>,
    /** 见过的人、只听说过的人和宿敌（交过手）；诉求、底线和秘密只给模型看，不在这里 */
    npcs: Object.values(npcs.npcs)
      .filter(
        (n) =>
          n.met ||
          n.known.length > 0 ||
          nemesisState.nemeses.some((x) => x.npc === n.id) ||
          nemesisState.ended.some((x) => x.npc === n.id),
      )
      .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
      .map((n) => ({
        id: n.id,
        name: n.name,
        alias: n.alias ?? null,
        pronoun: n.pronoun,
        /** 见过面没有；没见过的只是听说过，身份和样子不给 */
        met: n.met,
        role: n.met ? n.role : "只听说过",
        look: n.met ? n.look : "没见过",
        /** 玩家角色知道的这个人的事，旧的在前，带来源 */
        known: n.known.map((k) => ({
          text: k.text,
          sourceLabel: KNOWN_SOURCE_LABELS[k.source],
          at: formatGameTime(k.at),
        })),
        affinity: n.affinity,
        /** 玩家知道的生死：屏幕外死的，听说以前照旧显示活着 */
        alive: !deathKnown(n),
        here: onStage(n, stage),
        /** 最后一次见面的游戏时间；没见过面（只有消息往来）是 null */
        lastSeen: n.lastSeenAt === null ? null : formatGameTime(n.lastSeenAt),
        relation: n.relation?.text ?? null,
        /** 人情和仇：没了结的在前，各自旧的在前 */
        ledger: [
          ...n.ledger.filter((e) => e.settledAt === null),
          ...n.ledger.filter((e) => e.settledAt !== null),
        ].map((e) => ({
          kind: e.kind,
          label: LEDGER_KIND_LABELS[e.kind],
          text: e.text,
          at: formatGameTime(e.at),
          settled: e.settledAt === null ? null : formatGameTime(e.settledAt),
          how: e.how ?? null,
        })),
        memories: n.memories,
        /**
         * 身体：见过的人看伤势和装备；扫描过的再看档位、威胁、属性、生命、义体和人性阶段。
         * 人性数值只给叙事模型，这里没有；没见过的人是 null
         */
        body: n.met
          ? bodyView(n, data, world.time, attributeSum(effectiveAttributes(character)))
          : null,
        /**
         * 宿敌：怎么输给你的；准备只在扫描或打听到以后给，屏幕外的动静不在这里。
         * 了结了的写怎么了结的；不是宿敌是 null
         */
        nemesis: (() => {
          const a = nemesisState.nemeses.find((x) => x.npc === n.id);
          if (a) {
            return {
              how: a.how,
              since: formatGameTime(a.since),
              prep:
                a.prep && a.known
                  ? `专克${NEMESIS_STYLE_LABELS[a.prep.against]}：${a.prep.text}`
                  : null,
              ended: null,
            };
          }
          const e = nemesisState.ended.find((x) => x.npc === n.id);
          return e
            ? {
                how: e.how,
                since: formatGameTime(e.since),
                prep: null,
                ended: `${NEMESIS_END_LABELS[e.end]}：${e.text}`,
              }
            : null;
        })(),
        /**
         * 心事：这个人跟玩家说过的事和玩家听说的结果；处境、盼头、走向和原作结局只给模型看，不在这里。
         * 还没熟到能说心事、也没说过任何一件的是 null
         */
        arc: (() => {
          const seed = arcSeeds.get(n.id);
          const progress = arcState.arcs[n.id];
          if (!seed || !progress) return null;
          const concerns = seed.concerns.flatMap((c) => {
            const p = progress.concerns[c.id];
            if (!p) return [];
            const heard = p.outcome?.known === true;
            if (p.status === null && !heard) return [];
            return [
              {
                id: c.id,
                title: c.title,
                status: heard ? "resolved" : p.status,
                statusLabel: heard
                  ? CONCERN_STATUS_LABELS.resolved
                  : CONCERN_STATUS_LABELS[p.status ?? "told"],
                outcome: heard && p.outcome ? p.outcome.text : null,
              },
            ];
          });
          if (progress.unlockedAt === null && concerns.length === 0) return null;
          return { done: progress.doneAt !== null, concerns };
        })(),
      })),
    /** 侧栏「新闻」：场外推演写的 N54 快讯和电台插段，新的在前；本来就是公开播的，只有原文，不带动静和传闻的真假 */
    bulletins: views.bulletins as ReturnType<typeof bulletinsView>,
    /** 记忆面板：场景摘要（新的在前）和最近的修改记录；共同记忆在 npcs 里 */
    memory: (() => {
      const m = MemoryStateSchema.parse(world.slices.memory ?? {});
      return {
        scenes: [...m.scenes].reverse().map((s) => ({
          scene: s.scene,
          at: formatGameTime(s.at),
          title: s.title,
          text: s.text,
          importance: s.importance,
          importanceLabel: IMPORTANCE_LABELS[s.importance],
          people: s.people.map((id) => npcs.npcs[id]?.name ?? id),
          edited: s.edited === true,
        })),
        edits: [...m.edits]
          .reverse()
          .slice(0, MEMORY_EDITS_SHOWN)
          .map((e) => ({
            at: formatGameTime(e.at),
            what: e.what === "scene" ? "场景摘要" : "共同记忆",
            ref: e.ref,
            action: e.action === "edit" ? "改写" : "删掉",
            before: e.before,
            after: e.after,
          })),
      };
    })(),
    money: views.money as ReturnType<typeof moneyView>,
    /** 警方热度：整星，另标有没有攒着半星；自然下降还要多久（分钟） */
    heat: {
      stars: shownStars(heat?.stars ?? 0),
      half: (heat?.stars ?? 0) % 1 !== 0,
      lastSeen: heat?.lastSeenAt == null ? null : formatGameTime(heat.lastSeenAt),
      /** 没了结的悬赏：不随时间消失 */
      bounties: (heat?.bounties ?? [])
        .filter((b) => b.resolvedAt === null)
        .map((b) => ({
          id: b.id,
          reward: b.reward,
          reasons: b.reasons,
          hunter: b.hunter,
          hunterName: b.hunter === null ? null : (npcs.npcs[b.hunter]?.name ?? b.hunter),
          since: formatGameTime(b.at),
        })),
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
        affinity: npcs.npcs[f.id]?.affinity ?? 0,
        maxRisk: maxRisk(npcs.npcs[f.id]?.affinity ?? 0, character.streetCred),
        cappedBy: riskCap(npcs.npcs[f.id]?.affinity ?? 0, character.streetCred).by,
        capHint: riskCap(npcs.npcs[f.id]?.affinity ?? 0, character.streetCred).hint,
      })),
      list: [
        ...jobs.jobs.filter(isOpen),
        ...jobs.jobs.filter((j) => !isOpen(j)).slice(-JOBS_CLOSED_SHOWN),
      ].map((j) => ({
        id: j.id,
        title: j.title,
        /** 委托类型，例如“护送”；没写类型是 null */
        kindLabel: j.kind ? JOB_KIND_LABELS[j.kind] : null,
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
        /** 结算卡：声望按级、中间人好感变化、接单以来的人性变化 */
        settlement:
          j.settlement === null
            ? null
            : {
                squad: j.settlement.squad,
                streetCred: j.settlement.credHalves / 2,
                affinity: j.settlement.affinity,
                humanity: j.settlement.humanity,
              },
      })),
    },
    deadlines: clockView.deadlines,
    offers: projectOffers(world, records),
    /** 能用的加速义体；没装或打坏了是 null */
    sandevistan: sandevistanOf(world, data),
    /** 消息，最近的在前 */
    phone: {
      unread: phoneState.messages.filter((m) => !m.read).length,
      messages: [...phoneState.messages]
        .reverse()
        .slice(0, PHONE_SHOWN)
        .map((m) => ({
          id: m.id,
          from: m.from,
          name: m.name,
          text: m.text,
          at: formatGameTime(m.at),
          read: m.read,
          replied: m.replied,
          reply: m.reply ?? null,
          repliedAt: m.repliedAt === undefined ? null : formatGameTime(m.repliedAt),
        })),
      /** 联系人：按最后一条消息排，新的在前；有人物卡的带好感和死活 */
      contacts: (() => {
        const latest = new Map<string, (typeof phoneState.messages)[number]>();
        for (const m of phoneState.messages) latest.set(m.from, m);
        return [...latest.values()]
          .sort((a, b) => b.at - a.at || b.id - a.id)
          .map((m) => {
            const npc = npcs.npcs[m.from];
            return {
              from: m.from,
              name: m.name,
              npc: npc?.met ? npc.id : null,
              affinity: npc?.met ? npc.affinity : null,
              alive: npc ? !deathKnown(npc) : true,
              last: formatGameTime(Math.max(m.at, m.repliedAt ?? m.at)),
              unread: phoneState.messages.filter((x) => x.from === m.from && !x.read).length,
              count: phoneState.messages.filter((x) => x.from === m.from).length,
            };
          });
      })(),
    },
    /** 别人眼里的你：交给叙事模型，NPC 的第一反应照这一行写 */
    perceived: perceivedLine(
      {
        traits: character.traits,
        streetCred: character.streetCred,
        clothing: inventory.clothing,
        installed,
        lostLimbs: health.lostLimbs,
        wound: woundTag(health),
        heatStars: shownStars(heat?.stars ?? 0),
      },
      parts,
      items,
    ),
    totalTurns: turns.length,
    turns: turns.slice(-VIEW_TURNS).map((t, i, shown) => ({
      seq: t.seq,
      /** 场景的第一轮：给出场景标题卡的一行；界面按叙事偏好决定显示不显示 */
      sceneTitle:
        t.title !== undefined &&
        t.scene !== undefined &&
        turns[turns.length - shown.length + i - 1]?.scene !== t.scene
          ? t.title
          : null,
      /** 这一轮弹出的特写卡 */
      closeup: t.closeup ?? null,
      at: t.at,
      input: turnInput(t.input),
      text: t.text,
      voices: readVoices(t.voices),
      dice: t.dice,
      /** 被丢弃的指令条数；大于 0 时界面提示“本轮有数值没结算” */
      dropped: t.dropped.length,
      /** 未定稿的原因：正文和账目对不上，界面提示并给“重新生成” */
      unsettled: t.unsettled ?? null,
      /** 这一轮短暂失控：玩家的意图和实际发生的事 */
      lostControl: lostControlOf(t.commands),
      /** 落在严重发作后的记忆空白里：角色视角折起来，原文以回合日志为准 */
      blackout: blackoutTurns(turns, world.slices.psychosis).has(t.seq),
    })),
  };
}

export type PlayerView = ReturnType<typeof projectState>;

/** 路线面板提交前的检查：走不了时返回原因 */
export function travelBlock(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  travel: TravelRequest,
): string | null {
  const plan = planTrip(tripWorldOf(world), data, travel);
  return plan.ok ? null : plan.reason;
}
