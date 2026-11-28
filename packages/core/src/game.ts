/** 新存档的初始世界和给玩家看的状态投影；后端和网页共用 */

import { feedDeliveries } from "./kernel/system";
import {
  applyRecordPatches,
  effectiveTurns,
  type LogRecord,
  logVersion,
  restartedScenes,
  voidedSeqs,
} from "./kernel/turnlog";
import type { WorldState } from "./kernel/world";
import { looseCyberwareView } from "./loose-cyberware-view";
import { currentOffers } from "./narrator/pending";
import { customCyberwareDefs, customItemDefs, resolveStartEddies } from "./schemas/board";
import { replacedNpcIdOf } from "./schemas/character";
import type { SaveMeta } from "./schemas/save";
import { type TurnInput, TurnInputSchema } from "./schemas/turn";
import type { arcCardsView } from "./systems/arcs";
import type { braindanceView } from "./systems/braindance";
import type { characterView } from "./systems/character";
import type { chronicleView, endedView } from "./systems/chronicle";
import type { bulletinsView } from "./systems/city";
import type { combatView } from "./systems/combat";
import {
  type ArmSide,
  type CyberwareDef,
  CyberwareStateSchema,
  checkCyberwareInstall,
  type cyberwarePartsView,
  type cyberwareView,
  type Ripperdoc,
  type ripperdocDebtsView,
  ripperdocList,
  type ripperdocView,
  sandevistanOf,
  type sandevistanView,
} from "./systems/cyberware";
import type { moneyView } from "./systems/economy";
import type { FactionDef, factionsView } from "./systems/factions";
import type { hackingView, QuickhackDef } from "./systems/hacking";
import { HealthStateSchema, type healthView } from "./systems/health";
import type { heatView } from "./systems/heat";
import type { humanityView } from "./systems/humanity";
import {
  type ItemDef,
  type inventoryView,
  type namesView,
  type Shop,
  shopList,
  type shopsView,
} from "./systems/inventory";
import type { jobsView } from "./systems/jobs";
import type { memoryView } from "./systems/memory";
import type { ncpdView } from "./systems/ncpd";
import type { nemesesEndedView, nemesisCardsView } from "./systems/nemesis";
import {
  type InitialNpcTie,
  type NpcCard,
  NpcStateSchema,
  type npcsView,
  type perceivedView,
} from "./systems/npc";
import {
  type ContactEntry,
  PhoneStateSchema,
  type phoneCallsView,
  phoneFeedUnread,
  type phoneMessagesView,
} from "./systems/phone";
import {
  blackoutTurns,
  episodeOf,
  lostControlOf,
  type psychosisView,
} from "./systems/psychosis/apply";
import { registry } from "./systems/registry";
import type { HomeDef, safehouseView } from "./systems/safehouse";
import type { shardsView } from "./systems/shards";
import type { sidegigsView } from "./systems/sidegigs/apply";
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
import { withSavedPlaces } from "./systems/world/places";
import { type LocationDef, locationCatalog, WorldClockStateSchema } from "./systems/world/schema";
import { pendingUiActions, uiActionsBeforeTurn } from "./ui-actions";

/** 状态接口最多带最近这么多轮的正文；更早的按需翻页 */
export const VIEW_TURNS = 50;

/** 新存档要放进世界的静态内容（content 包），例如原作人物卡 */
export interface GameContent {
  readonly npcs?: readonly NpcCard[];
  /** 预制人物之间的初始双向关系网（建档时写入双方 ties） */
  readonly npcTies?: readonly InitialNpcTie[];
  /** 物品表；开局装备要用它结算 */
  readonly items?: readonly ItemDef[];
  /** 义体表；开局自带的义体要用它结算 */
  readonly cyberware?: readonly CyberwareDef[];
  /** 商家初始条件；首次到访即把当时的身份与现货保存进世界。 */
  readonly shops?: readonly Shop[];
  readonly ripperdocs?: readonly Ripperdoc[];
  /** 快速破解表；开局自带的程序要用它结算 */
  readonly quickhacks?: readonly QuickhackDef[];
  /** 车型表；开局送车时要用 */
  readonly vehicles?: readonly VehicleDef[];
  /** 势力表；按出身给开局初始势力态度时要用 */
  readonly factions?: readonly FactionDef[];
  /** 中间人；好感记在同 id 的人物卡上 */
  readonly fixers?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  /** 原作固定地点（地点表） */
  readonly locations?: readonly LocationDef[];
  /** 可选的开场；存档的 meta.opening 记着用的是哪一个 */
  readonly openings?: readonly GameOpening[];
  /** 按出身和经历发的开局行装；存档的 meta.loadouts 记着发了哪几套 */
  readonly loadouts?: readonly Loadout[];
  /** 开局住所，按出身给 */
  readonly homes?: readonly HomeDef[];
  /** 开场没写 cast 时种哪些人物卡和中间人（旧存档）；都没写就全种 */
  readonly defaultCast?: readonly string[];
  /**
   * 解析开局地点用的地图数据（和结算时 data 里的同名几项一样：radar、mapAreas、servicePoints）。
   * 建档时在地图上选了原作地标（ft:）或服务点（poi:）开局，要靠它记进存档，坐标照原作
   * （用户定的，2026-10-30："可以选择地点开局"，开局地点"在地图上选择"）；没给时只能从原作固定地点开局
   */
  readonly mapData?: Readonly<Record<string, unknown>>;
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
  /** 精确匹配的出身模块 id 列表（优先于 keywords）；未列出时按 keywords 匹配 */
  readonly origins?: readonly string[];
  /** origin 看角色卡的出身，background 还看过往和本事；出现这些词就用这一套 */
  readonly keywords: readonly string[];
  /** 该出身进入自由沙盘时默认出生点锚点 id（须在地图锚点表中） */
  readonly defaultLocation?: string;
  readonly gear: GameOpening["gear"];
  readonly eddies?: number;
  readonly cyberware?: readonly string[];
  /** 开局名下的车（车型 id） */
  readonly vehicles?: readonly string[];
}

export interface LoadoutMatchInput {
  readonly originId?: string;
  readonly origin: string;
  readonly past?: string;
  readonly skills?: string;
}

/**
 * 建档时按角色卡挑行装：
 * 1) 有精确出身模块 id（board.origin.id）时，先按 id / origins 列表精确命中出身套装；
 * 2) 未命中（例如自定义出身或旧纯文字卡）再按 keywords 末次出现位置匹配，没有就用 fallback；
 * 3) background 附带行装可由出身 id 或过往/特长关键词触发叠加。
 */
export function pickLoadouts(
  card: LoadoutMatchInput,
  loadouts: readonly Loadout[],
  fallback: string,
): string[] {
  const { originId } = card;
  const at = (text: string, l: Loadout) => {
    const hits = l.keywords
      .map((k) => text.toLowerCase().lastIndexOf(k.toLowerCase()))
      .filter((i) => i >= 0);
    return hits.length === 0 ? -1 : Math.max(...hits);
  };
  const originList = loadouts.filter((l) => l.kind === "origin");
  const exactOrigin =
    originId === undefined
      ? undefined
      : originList.find((l) => l.id === originId || l.origins?.includes(originId));
  const keywordOrigin = originList
    .map((l) => [l, at(card.origin, l)] as const)
    .filter(([, i]) => i >= 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const chosenOrigin = exactOrigin?.id ?? keywordOrigin?.id ?? fallback;
  const story = [card.origin, card.past ?? "", card.skills ?? ""].join("\n");
  const extras = loadouts.filter(
    (l) =>
      l.kind === "background" &&
      ((originId !== undefined && l.origins?.includes(originId)) || at(story, l) >= 0),
  );
  return [chosenOrigin, ...extras.map((l) => l.id)];
}

/** 按出身挑自由沙盘的默认出生点锚点；未指定时退回 fallback */
export function pickStartLocation(
  card: LoadoutMatchInput,
  loadouts: readonly Loadout[],
  fallback = "megabuilding-h10",
): string {
  if (loadouts.length === 0) return fallback;
  const ids = pickLoadouts(card, loadouts, "");
  for (const id of ids) {
    const hit = loadouts.find((l) => l.id === id);
    if (hit?.kind === "origin" && hit.defaultLocation) return hit.defaultLocation;
  }
  return fallback;
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
type KitGearEntry = GameOpening["gear"][number] & { readonly count?: number | undefined };

interface Kit {
  readonly gear: readonly KitGearEntry[];
  readonly eddies?: number | undefined;
  readonly cyberware?: readonly string[] | undefined;
  readonly vehicles?: readonly string[] | undefined;
}

function mergeKits(loadouts: readonly Loadout[]): Kit {
  const gearById = new Map<string, GameOpening["gear"][number]>();
  for (const l of loadouts) {
    for (const g of l.gear) {
      const prev = gearById.get(g.id);
      gearById.set(
        g.id,
        prev
          ? {
              id: g.id,
              ...(prev.equip || g.equip ? { equip: true } : {}),
              ...(g.slot !== undefined
                ? { slot: g.slot }
                : prev.slot !== undefined
                  ? { slot: prev.slot }
                  : {}),
            }
          : g,
      );
    }
  }
  return {
    gear: [...gearById.values()],
    eddies: loadouts.reduce((sum, l) => sum + (l.eddies ?? 0), 0),
    cyberware: [...new Set(loadouts.flatMap((l) => l.cyberware ?? []))],
    vehicles: [...new Set(loadouts.flatMap((l) => l.vehicles ?? []))],
  };
}

/** 结合玩家自选义体结算行装自带义体：避免同部位互斥、空间超限或承载越顶 */
function resolveStartKit(
  kit: Kit,
  boardCyberware: readonly string[],
  cyberwareSides: Readonly<Record<string, ArmSide>> | undefined,
  cyberwareCatalog: readonly CyberwareDef[] | undefined,
): Kit {
  if (!cyberwareCatalog || cyberwareCatalog.length === 0) return kit;
  const byId = new Map(cyberwareCatalog.map((c) => [c.id, c]));
  const placed: (CyberwareDef & { readonly armSide?: ArmSide | undefined })[] =
    boardCyberware.flatMap((id) => {
      const def = byId.get(id);
      if (!def) return [];
      const side = cyberwareSides?.[id];
      return [side ? { ...def, armSide: side } : def];
    });
  const cyberware: string[] = [];
  for (const id of kit.cyberware ?? []) {
    const def = byId.get(id);
    if (!def) {
      cyberware.push(id);
      continue;
    }
    if (placed.some((p) => p.id === def.id)) continue;
    if (!checkCyberwareInstall(def, placed).ok) continue;
    placed.push(def);
    cyberware.push(id);
  }
  return { ...kit, cyberware };
}

function applyBoardKit(
  base: Kit,
  boardKit: NonNullable<SaveMeta["board"]>["kit"],
  content: GameContent,
): Kit {
  if (!boardKit) return base;
  const eddies = resolveStartEddies(base.eddies ?? 0, boardKit);
  const gear: KitGearEntry[] = [...base.gear];
  const usedSlots = new Set<number>(gear.flatMap((g) => (g.slot !== undefined ? [g.slot] : [])));
  const validItems = content.items ? new Set(content.items.map((i) => i.id)) : null;
  for (const weaponId of boardKit.weapons) {
    if (validItems && !validItems.has(weaponId)) continue;
    if (gear.some((g) => g.id === weaponId)) continue;
    const freeSlot = ([1, 2, 3] as const).find((s) => !usedSlots.has(s));
    if (freeSlot !== undefined) {
      usedSlots.add(freeSlot);
      gear.push({ id: weaponId, equip: true, slot: freeSlot });
    } else {
      gear.push({ id: weaponId, equip: false });
    }
  }
  for (const entry of boardKit.items ?? []) {
    if (validItems && !validItems.has(entry.id)) continue;
    const count = Math.max(1, Math.min(20, Math.floor(entry.count ?? 1)));
    const existingIdx = gear.findIndex((g) => g.id === entry.id);
    if (existingIdx >= 0) {
      const prev = gear[existingIdx];
      if (prev) {
        gear[existingIdx] = { ...prev, count: (prev.count ?? 1) + count };
      }
    } else {
      gear.push({ id: entry.id, equip: false, count });
    }
  }
  const validVehicles = content.vehicles ? new Set(content.vehicles.map((v) => v.id)) : null;
  const chosenVehicle =
    boardKit.vehicle && (!validVehicles || validVehicles.has(boardKit.vehicle))
      ? boardKit.vehicle
      : null;
  // 玩家显式指定了专属载具时替换掉出身默认载具，避免同开局重叠两辆车
  const vehicles = chosenVehicle ? [chosenVehicle] : [...(base.vehicles ?? [])];
  return {
    ...base,
    gear,
    eddies,
    vehicles,
  };
}

function openingCommands(opening: GameOpening, start: number, kit: Kit = opening): unknown[] {
  const reason = `开局：${opening.title}`;
  return [
    ...kit.gear.flatMap((g) =>
      Array.from({ length: Math.max(1, g.count ?? 1) }, () => ({
        type: "item",
        action: "gain",
        id: g.id,
        reason,
      })),
    ),
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

/** 新存档的世界：按存档的开场时间与标准夜之城规则初始化，写入玩家角色和原作人物卡 */
export function newGameWorld(
  meta: Pick<SaveMeta, "startTime"> &
    Partial<Pick<SaveMeta, "character" | "opening" | "startLocation" | "loadouts" | "board">>,
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
  // 若玩家扮演原作人物（例如 V），开局自动跳过对应 NPC 及其自指旧识/关系，绝不刷出两个 V
  const replacedNpcId = replacedNpcIdOf(meta.character);
  // 捏人选成旧识或主动改写过卡面的原作人物：不在开场人物里的也放进来
  const acquaintances = (meta.board?.acquaintances ?? []).filter((a) => a.id !== replacedNpcId);
  const npcOverrideMap = new Map(
    (meta.board?.npcOverrides ?? [])
      .filter((card) => card.id !== replacedNpcId)
      .map((card) => [card.id, card] as const),
  );
  const inCast = (id: string) =>
    id !== replacedNpcId &&
    (castIds === undefined ||
      castIds.includes(id) ||
      acquaintances.some((a) => a.id === id) ||
      npcOverrideMap.has(id));
  const cast = (content.npcs ?? []).filter((c) => inCast(c.id));
  /** 先应用角色级原作卡面覆写，再按旧识关系表盖过开局见面状态、关系笔记与人情账本 */
  const castSeed = (card: (typeof cast)[number]) => {
    const overridden = npcOverrideMap.get(card.id);
    const merged = overridden ? { ...card, ...overridden, id: card.id, canon: card.canon } : card;
    const a = acquaintances.find((x) => x.id === card.id);
    return a
      ? {
          ...merged,
          met: true,
          ...(a.relation ? { relation: a.relation } : {}),
          ledger: a.ledger,
        }
      : merged;
  };
  const base = registry.initialWorld(meta.startTime);
  const clock = WorldClockStateSchema.parse(base.slices.world);
  const world: WorldState = {
    ...base,
    slices: {
      ...base.slices,
      world: {
        ...clock,
        // 先放在开场自带的地点；建档时选了开局地点的，由最后那条 world 指令换过去并记进存档（见 commands 末尾）
        location: opening?.location ?? clock.location,
        startedAt: meta.startTime,
        sceneStartedAt: meta.startTime,
      },
    },
  };
  const baseCyberware = content.cyberware ?? [];
  const extraCyberware = customCyberwareDefs(
    meta.board?.customCyberware,
    new Set(baseCyberware.map((c) => c.id)),
  );
  const effectiveCyberware =
    extraCyberware.length > 0 ? [...baseCyberware, ...extraCyberware] : content.cyberware;
  const baseItems = content.items ?? [];
  const extraItems = customItemDefs(
    meta.board?.kit?.customItems,
    new Set(baseItems.map((i) => i.id)),
  );
  const effectiveItems = extraItems.length > 0 ? [...baseItems, ...extraItems] : content.items;
  const effectiveContent: GameContent =
    extraItems.length > 0 ? { ...content, items: [...baseItems, ...extraItems] } : content;
  const rawKit = opening && (loadouts.length > 0 ? mergeKits(loadouts) : opening);
  const adjustedKit = rawKit && applyBoardKit(rawKit, meta.board?.kit, effectiveContent);
  const validCyberware = effectiveCyberware ? new Set(effectiveCyberware.map((c) => c.id)) : null;
  // 主板的义体在开局行装之后装：先根据部位上限筛掉会被顶掉的自带件
  const boardCyberware = (meta.board?.cyberware ?? []).filter(
    (id) =>
      !(adjustedKit?.cyberware ?? []).includes(id) && (!validCyberware || validCyberware.has(id)),
  );
  const boardSides = meta.board?.cyberwareSides;
  const kit =
    adjustedKit && resolveStartKit(adjustedKit, boardCyberware, boardSides, effectiveCyberware);
  const boardPeople = (meta.board?.people ?? []).filter(
    (p) => p.id !== replacedNpcId && !cast.some((c) => c.id === p.id || c.name === p.name),
  );
  const seededNpcIds = new Set<string>([...cast.map((c) => c.id), ...boardPeople.map((p) => p.id)]);
  const initialContacts = new Set<string>([
    ...cast.filter((card) => acquaintances.some((a) => a.id === card.id)).map((card) => card.id),
    ...boardPeople.filter((p) => p.met !== false).map((p) => p.id),
  ]);
  const initialTies = (content.npcTies ?? []).filter(
    (t) => seededNpcIds.has(t.a) && seededNpcIds.has(t.b),
  );
  const commands: unknown[] = [
    ...(meta.character ? [{ type: "character.set", ...meta.character }] : []),
    ...cast.map((card) => ({ type: "npc.seed", ...castSeed(card) })),
    ...boardPeople.map((p) => ({ type: "npc.seed", ...p })),
    ...initialTies.map((t) => ({ type: "tie", ...t })),
    ...(content.fixers ?? [])
      .filter((f) => inCast(f.id))
      .map((f) => ({ type: "jobs.seedFixer", ...f })),
    ...[...initialContacts].map((id) => ({
      type: "phone.seedContact",
      id,
      source: "opening" as const,
    })),
    ...(opening && kit ? openingCommands(opening, meta.startTime, kit) : []),
    ...boardCyberware.map((id) => ({
      type: "cyberware.install",
      id,
      ...(boardSides?.[id] ? { armSide: boardSides[id] } : {}),
    })),
    ...homeSeed(content, meta.board?.origin),
    ...factionSeed(content, meta.board?.origin),
    // 开局地点“在地图上选择”（用户定的，2026-10-30）：沿用 world 的解析登记原作地点，不写 time，不推进时间
    ...(meta.startLocation !== undefined
      ? [{ type: "world", activity: "travel", location: meta.startLocation }]
      : []),
    // 先确定最终开局地点，再把车辆停在玩家身边。
    ...(kit?.vehicles ?? []).map((model) => ({
      type: "vehicle.grant",
      model,
      reason: `开局：${opening?.title ?? "行装"}`,
    })),
  ];
  const parsed = commands.map((raw) => {
    const result = registry.parseInternal(raw);
    if (!result.ok) throw new Error(`开局内容不合格：${result.error}`);
    return result.command;
  });
  const setupContext = {
    rng: setupRng,
    data: {
      // 开局地点在地图上选择（用户定的，2026-10-30）：沿用 world 的地点解析，不另编坐标
      ...(content.mapData ?? {}),
      ...(content.locations ? { locations: content.locations } : {}),
      ...(effectiveItems ? { items: effectiveItems } : {}),
      ...(effectiveCyberware ? { cyberware: effectiveCyberware } : {}),
      ...(content.shops ? { shops: content.shops } : {}),
      ...(content.ripperdocs ? { ripperdocs: content.ripperdocs } : {}),
      ...(content.quickhacks ? { quickhacks: content.quickhacks } : {}),
      ...(content.vehicles ? { vehicles: content.vehicles } : {}),
      ...(content.factions ? { factions: content.factions } : {}),
    },
  };
  const applied = registry.applyCommands(world, parsed, setupContext);
  for (const { command, result } of applied.results) {
    if (!result.ok) throw new Error(`开局的 ${command.type} 没有生效：${result.reason}`);
  }
  return registry.signal(applied.world, "world.arrived", setupContext).world;
}

/** 按出身给开局初始势力态度；只给原作/设定里有清晰渊源的出身，其余保持默认中立 */
const ORIGIN_FACTION_SEEDS: Readonly<
  Record<
    string,
    { readonly faction: string; readonly attitude: "friendly" | "hostile"; readonly reason: string }
  >
> = {
  nomad: { faction: "aldecaldos", attitude: "friendly", reason: "恶土同族情面" },
  "origin-badlands-scout": { faction: "aldecaldos", attitude: "friendly", reason: "恶土同族情面" },
  "origin-badlands-tech": { faction: "aldecaldos", attitude: "friendly", reason: "恶土同族情面" },
  corpo: { faction: "arasaka", attitude: "friendly", reason: "旧公司人脉" },
  "origin-corpo-pr": { faction: "arasaka", attitude: "friendly", reason: "旧公司人脉" },
  "origin-corpo-counterintel": { faction: "arasaka", attitude: "friendly", reason: "旧公司人脉" },
  "origin-arasaka-netrunner": {
    faction: "arasaka",
    attitude: "hostile",
    reason: "离开旧东家后被列入盯防名单",
  },
  "origin-ex-ncpd": { faction: "ncpd", attitude: "friendly", reason: "旧警队人脉" },
  "origin-trauma-medic": {
    faction: "trauma-team",
    attitude: "friendly",
    reason: "前创伤小组同事人脉",
  },
  "origin-war-vet": {
    faction: "sixth-street",
    attitude: "friendly",
    reason: "同为公司战争退伍兵圈子",
  },
  "origin-nightclub-rocker": { faction: "mox", attitude: "friendly", reason: "夜场圈熟人" },
  "origin-bd-editor": { faction: "mox", attitude: "friendly", reason: "丽姿超梦圈熟人" },
};

function factionSeed(content: GameContent, origin: string | undefined): unknown[] {
  if (origin === undefined) return [];
  const seed = ORIGIN_FACTION_SEEDS[origin];
  if (!seed) return [];
  const known = content.factions?.some((f) => f.id === seed.faction) ?? false;
  if (!known) return [];
  return [{ type: "faction.seed", id: seed.faction, attitude: seed.attitude, reason: seed.reason }];
}

/** 按出身给开局住所；先精确匹配 origin 或 origins 列表，对不上时回退 default */
function homeSeed(content: GameContent, origin: string | undefined): unknown[] {
  const homes = content.homes ?? [];
  const home =
    (origin !== undefined
      ? homes.find((h) => h.origin === origin || h.origins?.includes(origin))
      : undefined) ?? homes.find((h) => h.origin === "default");
  return home
    ? [
        {
          type: "safehouse.seed",
          id: home.id,
          name: home.name,
          location: home.location,
          tenure: home.tenure,
          ...(home.rentAmount !== undefined ? { rentAmount: home.rentAmount } : {}),
          ...(home.rentPeriodDays !== undefined ? { rentPeriodDays: home.rentPeriodDays } : {}),
        },
      ]
    : [];
}

/** 装着、没坏的第一件加速义体；定义搬进了 cyberware 系统，这里转出保持导出名不变 */
export { sandevistanOf } from "./systems/cyberware";

/** 这一轮能不能开斯安威斯坦；能开时返回 null，否则返回原因 */
export function sandevistanBlock(
  world: WorldState,
  _records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>>,
): string | null {
  return sandevistanOf(world, data) ? null : "没装能用的加速义体";
}

/** 旧存档还没有独立通讯录字段时，把已有通讯往来和曾见过面的人物一次性迁入 contacts */
function migrateLegacyPhoneContacts(
  rawPhone: Record<string, unknown>,
  rawNpc: unknown,
  now: number,
): Record<string, unknown> {
  if ("contacts" in rawPhone) return rawPhone;
  const parsedPhone = PhoneStateSchema.safeParse(rawPhone);
  const contacts: Record<string, ContactEntry> = {};
  if (parsedPhone.success) {
    for (const m of parsedPhone.data.messages) {
      if (contacts[m.from] === undefined) {
        contacts[m.from] = { addedAt: m.at, source: "inbound" };
      }
    }
    for (const c of parsedPhone.data.calls) {
      if (contacts[c.from] === undefined) {
        contacts[c.from] = { addedAt: c.at, source: "inbound" };
      }
    }
  }
  const parsedNpc = NpcStateSchema.safeParse(rawNpc);
  if (parsedNpc.success) {
    for (const npc of Object.values(parsedNpc.data.npcs)) {
      if (npc.met && contacts[npc.id] === undefined) {
        contacts[npc.id] = { addedAt: npc.lastSeenAt ?? now, source: "legacy" };
      }
    }
  }
  return { ...rawPhone, contacts };
}

/** 旧快照里没有后来加的系统和字段：缺的系统用初始值，缺的字段用 schema 默认值补上 */
export function withAllSlices(world: WorldState): WorldState {
  const base = registry.initialWorld(world.time);
  const slices: Record<string, unknown> = { ...world.slices };
  for (const system of registry.order) {
    let raw = slices[system.id];
    if (raw === undefined) {
      slices[system.id] = base.slices[system.id];
      continue;
    }
    if (system.id === "phone" && typeof raw === "object" && raw !== null) {
      raw = migrateLegacyPhoneContacts(raw as Record<string, unknown>, slices.npc, world.time);
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
    world = applyRecordPatches(world, record.patches);
    const now = sceneOf(world);
    if (now !== scene) {
      scene = now;
      start = record.seq + 1;
    }
  }
  return start;
}

/** 状态接口带上的已结束委托，最近的优先；定义搬进了 jobs 系统，这里转出保持导出名不变 */
export { JOBS_CLOSED_SHOWN } from "./systems/jobs";

function turnInput(raw: unknown): TurnInput {
  const parsed = TurnInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : { text: String(raw) };
}

interface ChoicePanelProjection {
  readonly text: string;
  readonly source: string | null;
}

/** 建议是可选的文字行动，玩家始终可以自由输入。 */
function projectOffers(records: readonly LogRecord[]) {
  const offers = currentOffers(records);
  return {
    read: offers.turn?.read ?? null,
    choices: offers.choices.map(
      (choice): ChoicePanelProjection => ({
        text: choice.text,
        source: choice.source ?? null,
      }),
    ),
    clutch: offers.turn?.clutch === true,
  };
}

/** 别人眼里的你搬进了 npc 系统，这里转出保持导出名不变 */
export { type Looks, perceivedLine } from "./systems/npc";

const EMPTY_DATA: Readonly<Record<string, unknown>> = Object.freeze({});

function computePlayerView(
  world: WorldState,
  records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>>,
  before?: WorldState,
) {
  const views = registry.project({ world, records, data });
  const clockView = views.clock as ReturnType<typeof worldView>;
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const health = HealthStateSchema.parse(world.slices.health);
  const turns = effectiveTurns(records);
  const voided = voidedSeqs(records);
  const activeRecords = records.filter(
    (record) => record.kind !== "void" && !voided.has(record.seq),
  );
  const blackouts = blackoutTurns(turns, world.slices.psychosis, activeRecords);
  const feed = registry.feed({ world, records, data });
  const carried = looseCyberwareView(
    views.inventory as ReturnType<typeof inventoryView>,
    views.names as ReturnType<typeof namesView>,
    views.cyberwareParts as ReturnType<typeof cyberwarePartsView>,
  );

  return {
    version: logVersion(records),
    /** 角色死了时不为 null：每个场景能从开头重来一次，重来过后再死则落幕 */
    death:
      health.condition === "dead"
        ? { canRestart: !restartedScenes(records).has(clock.scene) }
        : null,
    /** 整局重来过几个场景，履历里记着 */
    restarts: restartedScenes(records).size,
    /** 玩家结束了故事（退休或停在这里）；没结束是 null。和死透了一样，之后存档只读 */
    ended: views.ended as ReturnType<typeof endedView>,
    /** 履历：叙事模型写的段落、结束的委托、死亡和结束故事，按游戏时间从早到晚 */
    chronicle: views.chronicle as ReturnType<typeof chronicleView>,
    /** 了结了的宿敌：界面按新出现的弹结算卡；旧的在前 */
    nemesesEnded: views.nemesesEnded as ReturnType<typeof nemesesEndedView>,
    /** 超梦调查：正在查的录像（编辑器用）和查过的几次；旧存档没有超梦系统 */
    braindance: views.braindance as ReturnType<typeof braindanceView>,
    character: views.character as ReturnType<typeof characterView>,
    time: clockView.time,
    /** 天气：按时间、季节和城区算；还没有地点时按市区 */
    weather: clockView.weather,
    location: clockView.location,
    /** 界面显示用的中文名，查不到时为 id 或 null */
    names: carried.names,
    scene: clockView.scene,
    health: views.health as ReturnType<typeof healthView>,
    humanity: views.humanity as ReturnType<typeof humanityView>,
    inventory: carried.inventory,
    /** 装着的义体，按装上的先后 */
    cyberware: views.cyberware as ReturnType<typeof cyberwareView>,
    /** 玩家随身持有的未安装义体实物 */
    cyberwareParts: views.cyberwareParts as ReturnType<typeof cyberwarePartsView>,
    /** 网络接入仓定性信息、潜网和当前地点已攻破内网；没装接入仓是 null */
    hacking: views.hacking as ReturnType<typeof hackingView>,
    /** 地图上的地点和到每个地点的路线；路线面板照这里显示，结算用同一套算法 */
    travel: views.travel as ReturnType<typeof travelView>,
    /** 各势力对玩家的态度，和当前地点是谁的地盘 */
    factions: views.factions as ReturnType<typeof factionsView>,
    /** 扫描器上挂着的 NCPD 警情 */
    ncpd: views.ncpd as ReturnType<typeof ncpdView>,
    /** 创伤小组会籍，和现在叫不叫得来 */
    trauma: views.trauma as ReturnType<typeof traumaView>,
    /** 安全屋、存放箱与后备箱 */
    safehouse: views.safehouse as ReturnType<typeof safehouseView>,
    psychosis: views.psychosis as ReturnType<typeof psychosisView>,
    sidegigs: views.sidegigs as ReturnType<typeof sidegigsView>,
    /** 当前地点开着的义体医生；不在诊所时是 null */
    ripperdoc: views.ripperdoc as ReturnType<typeof ripperdocView>,
    /** 当前地点开着的商店 */
    shops: views.shops as ReturnType<typeof shopsView>,
    /** 欠义体医生的钱 */
    ripperdocDebts: views.ripperdocDebts as ReturnType<typeof ripperdocDebtsView>,
    combat: views.combat as ReturnType<typeof combatView>,
    /** 当前场景的潜入警戒度 */
    stealth: views.stealth as ReturnType<typeof stealthView>,
    /** 见过的人、只听说过的人和宿敌（交过手）；诉求、底线和秘密只给模型看，不在这里 */
    npcs: (() => {
      const rivals = views.nemesisCards as ReturnType<typeof nemesisCardsView>;
      const arcCards = views.arcCards as ReturnType<typeof arcCardsView>;
      const docs = ripperdocList(data);
      const stores = shopList(data);
      const places = locationCatalog(withSavedPlaces(data, world));
      const debts = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).debts;
      const placeLabel = (loc: string) => places.get(loc)?.name ?? loc;
      return (views.npcs as ReturnType<typeof npcsView>).map((n) => {
        const doc = n.met ? docs.find((d) => d.keeperNpc === n.id) : undefined;
        const ownedShops = n.met ? stores.filter((s) => s.keeperNpc === n.id) : [];
        const owed = doc ? debts.filter((d) => d.doc === doc.id) : [];
        const debt =
          owed.length > 0
            ? {
                amount: owed.reduce((sum, d) => sum + d.amount, 0),
                due: [
                  ...new Set(
                    owed.map((d) => (d.due === null ? "未约定期限" : formatGameTime(d.due))),
                  ),
                ].join(" / "),
              }
            : null;
        const services =
          doc || ownedShops.length > 0
            ? {
                ripperdoc: doc
                  ? {
                      id: doc.id,
                      name: doc.name,
                      location: doc.location,
                      locationName: placeLabel(doc.location),
                      blackMarket: doc.blackMarket,
                      credit: doc.credit,
                      debt,
                    }
                  : null,
                shops: ownedShops.map((s) => ({
                  id: s.id,
                  name: s.name,
                  location: s.location,
                  locationName: placeLabel(s.location),
                  blackMarket: s.blackMarket,
                  priceFactor: s.priceFactor,
                })),
              }
            : null;
        return {
          ...n,
          /** 宿敌一栏，由宿敌系统给；不是宿敌是 null */
          nemesis: Object.hasOwn(rivals, n.id) ? (rivals[n.id] ?? null) : null,
          /** 心事一栏，由心事系统给；还没熟到能说、也没说过任何一件的是 null */
          arc: Object.hasOwn(arcCards, n.id) ? (arcCards[n.id] ?? null) : null,
          /** 关联的常驻服务点（义体医生 / 商店）；没见过面或不经营服务点时为 null */
          services,
        };
      });
    })(),
    /** 侧栏「新闻」：场外推演写的 N54 快讯和电台插段，新的在前；本来就是公开播的，只有原文，不带动静和传闻的真假 */
    bulletins: views.bulletins as ReturnType<typeof bulletinsView>,
    /** 记忆面板：场景摘要（新的在前）和最近的修改记录；共同记忆在 npcs 里 */
    memory: views.memory as ReturnType<typeof memoryView>,
    money: views.money as ReturnType<typeof moneyView>,
    /** 警方热度：整星，另标有没有攒着半星；自然下降还要多久（分钟） */
    heat: views.heat as ReturnType<typeof heatView>,
    /** 委托和中间人；隐藏的转折只给模型看，不在这里 */
    jobs: views.jobs as ReturnType<typeof jobsView>,
    deadlines: clockView.deadlines,
    /** 待办：各系统交的委托、警情、拳赛赛车、心事和超梦，只有玩家知道的；按系统顺序，不排紧急程度 */
    objectives: registry.objectives({ world, records, data }),
    /** 威胁：警方热度、悬赏、宿敌和敌对势力；只用玩家知道的事定等级 */
    threats: registry.threats({ world, records, data }),
    /** 各系统交的公开消息，按时间倒序；投影不修改已读状态或发送额度 */
    feed,
    /**
     * 这一轮该弹的消息提醒：只比最新一条记录前后的消息，人发来的每条都算，其余来源每个游戏日一条，
     * 一轮最多两条，多的记 more；没有前态时是空的。按世界算出，刷新几次结果都一样
     */
    notifications: before
      ? feedDeliveries(registry.feed({ world: before, records: records.slice(0, -1), data }), feed)
      : { items: [], more: 0 },
    /** 各系统交的状态变化通知；没有前态时不把现有状态当成新事件 */
    events: before
      ? registry.events({
          before: { world: before, records: records.slice(0, -1), data },
          after: { world, records, data },
        })
      : [],
    offers: projectOffers(records),
    /** 能用的加速义体；没装或打坏了是 null */
    sandevistan: views.sandevistan as ReturnType<typeof sandevistanView>,
    /** 全息电话：正在响的那通和通话记录；打来的用意只给叙事模型，不在这里 */
    calls: views.calls as ReturnType<typeof phoneCallsView>,
    /** 数据库页的芯片：玩家读过的录音、邮件、日记原文，新读到的在前 */
    shards: views.shards as ReturnType<typeof shardsView>,
    /** 消息，最近的在前 */
    phone: (() => {
      const m = views.phoneMessages as ReturnType<typeof phoneMessagesView>;
      return {
        unread: m.unread,
        /** 各频道未读消息的 id；打开哪个频道就把那个频道的 id 交回 readMessages 标已读 */
        feedUnread: phoneFeedUnread(feed),
        messages: m.messages,
        /** 联系人：按最后一条消息排，新的在前；有人物卡的带好感和死活 */
        contacts: m.contacts,
      };
    })(),
    /** 别人眼里的你：交给叙事模型，NPC 的第一反应照这一行写 */
    perceived: views.perceived as ReturnType<typeof perceivedView>,
    /** 上一轮之后玩家在界面直接完成、待写进下一条正文的操作 */
    pendingUiActions: pendingUiActions(records),
    totalTurns: turns.length,
    turns: turns.slice(-VIEW_TURNS).map((t, i, shown) => {
      const input = turnInput(t.input);
      const prevTurnSeq = turns[turns.length - shown.length + i - 1]?.seq ?? -1;
      const uiActions = uiActionsBeforeTurn(records, t.seq, prevTurnSeq);
      const boosted = t.commands.some(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          (c as { type?: unknown }).type === "cyberware.boost",
      );
      return {
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
        /** 这一轮开始前通过界面直接完成的操作（已随本轮一起写进正文） */
        uiActions,
        input,
        /** 这一轮是否真正开启了斯安威斯坦（含界面开关、选项或判断阶段识别） */
        sandevistan: input.sandevistan === true || boosted,
        text: t.text,
        thought: t.thought ?? null,
        media: t.media ?? [],
        imageContext: t.imageContext ?? null,
        draft: t.draft === true,
        dice: t.dice,
        /** 被丢弃的指令条数；大于 0 时界面提示“本轮有数值没结算” */
        dropped: t.dropped.length,
        /** 未定稿的原因：正文和账目对不上，界面提示并给“重新生成” */
        unsettled: t.unsettled ?? null,
        /** 这一轮短暂失控：玩家的意图和实际发生的事 */
        lostControl: lostControlOf(t.commands),
        /** 这一轮的赛博精神病发作：诱因和严重度 */
        episode: episodeOf(t.commands),
        /** 落在严重发作后的记忆空白里：角色视角折起来，原文以回合日志为准 */
        blackout: blackouts.has(t.seq),
      };
    }),
  };
}

export type PlayerView = ReturnType<typeof computePlayerView>;

const projectStateCache = new WeakMap<
  WorldState,
  WeakMap<readonly LogRecord[], WeakMap<object, PlayerView>>
>();

/**
 * 玩家能看到的状态。只放界面要显示的东西：
 * 去重用的已结算事件、已用检定 id、换装防刷的次数记录、被丢弃的指令都不出现；
 * 同回合不可变 (world, records, data) 且不计算事件差异时弱缓存，避免三阶段与裁剪循环重复投影。
 */
export function projectState(
  world: WorldState,
  records: readonly LogRecord[],
  /** 静态数据表；带物品表和地点表时给出中文名 */
  data: Readonly<Record<string, unknown>> = EMPTY_DATA,
  /** 最新一条记录之前的世界；给了才出系统通知，没给时 events 是空的 */
  before?: WorldState,
): PlayerView {
  if (before === undefined) {
    const hit = projectStateCache.get(world)?.get(records)?.get(data);
    if (hit !== undefined) return hit;
  }
  const view = computePlayerView(world, records, data, before);
  if (before === undefined) {
    let byRecords = projectStateCache.get(world);
    if (!byRecords) {
      byRecords = new WeakMap();
      projectStateCache.set(world, byRecords);
    }
    let byData = byRecords.get(records);
    if (!byData) {
      byData = new WeakMap();
      byRecords.set(records, byData);
    }
    byData.set(data, view);
  }
  return view;
}

/** 路线面板提交前的检查：走不了时返回原因 */
export function travelBlock(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  travel: TravelRequest,
): string | null {
  // 存档记下的地点并进地点表：place:、poi:、ft: 也能当出行的目的地
  const plan = planTrip(tripWorldOf(world), withSavedPlaces(data, world), travel);
  return plan.ok ? null : plan.reason;
}
