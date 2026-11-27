import type { WorldState } from "../../kernel/world";
import { cyberwareCatalog, SLOT_LABELS } from "../../systems/cyberware";
import { RARITY_LABELS, type Rarity } from "../../systems/economy";
import {
  CLOTHING_SLOT_LABELS,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  itemCatalog,
  summarizeAbility,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
} from "../../systems/inventory";
import { NpcStateSchema } from "../../systems/npc";

/** 同一世界状态下两阶段看到相同候选；只轮换参考，不替人物随机配装。 */
function rank(seed: string, id: string): number {
  let value = 2166136261;
  for (const char of `${seed}:${id}`) {
    value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  }
  return value >>> 0;
}

/** 顶级件单列，避免“少用”把普通人的候选全换成昂贵军用植入物。 */
function budget(rarity: Rarity | undefined): string {
  if (rarity === "legendary") return "顶级";
  if (rarity === "rare" || rarity === "epic") return "专业";
  return "基础";
}

interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly variant: string;
  readonly line: string;
}

/** 每个用途/预算桶保留一个代表，同桶内先考虑近期少用的型号。完整目录仍供抽取核对。 */
function representatives(
  candidates: readonly Candidate[],
  counts: ReadonlyMap<string, number>,
  seed: string,
): Candidate[] {
  const buckets = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.group}:${candidate.variant}`;
    const previous = buckets.get(key);
    const used = counts.get(candidate.id) ?? 0;
    const previousUsed = previous ? (counts.get(previous.id) ?? 0) : 0;
    if (
      !previous ||
      used < previousUsed ||
      (used === previousUsed && rank(seed, candidate.id) < rank(seed, previous.id))
    ) {
      buckets.set(key, candidate);
    }
  }
  return [...buckets.values()];
}

function groupedLines(candidates: readonly Candidate[]): string {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const lines = groups.get(candidate.group) ?? [];
    lines.push(candidate.line);
    groups.set(candidate.group, lines);
  }
  return [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
}

const STAPLE_CHROME_IDS = [
  "kiroshi-mk1",
  "biomonitor",
  "syn-lungs",
  "clutch-padding",
  "prosthetic-arms",
  "prosthetic-legs",
  "subdermal-armor",
  "smart-link",
  "self-ice",
  "grounding-plating",
  "fireproof-coating",
  "biotech-sigma",
  "fuyutsuki-deck",
] as const;

/** 新人物的装备创作与建卡共用真实目录的用途参考，不改动任何人物或物件状态。 */
export function npcEquipmentReference(
  world: WorldState,
  data: Readonly<Record<string, unknown>> | undefined,
  includeIds = false,
): string | undefined {
  if (!data) return undefined;
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc ?? {}).npcs);
  // 未见过的原作人物不是模型最近的配装选择，不能拿内容包的默认配置惩罚常见型号。
  const customMet = npcs.filter((npc) => npc.met && !npc.canon);
  const recent = [...customMet]
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, 16);
  const objects = InventoryStateSchema.parse(world.slices.inventory ?? {}).objects;
  const gearCounts = new Map<string, number>();
  const chromeCounts = new Map<string, number>();
  for (const npc of recent) {
    const models = (npc.body?.gear ?? []).map((id) => objects[id]?.weaponState?.baseId ?? id);
    for (const id of new Set(models)) gearCounts.set(id, (gearCounts.get(id) ?? 0) + 1);
    for (const id of new Set(npc.body?.cyberware ?? [])) {
      chromeCounts.set(id, (chromeCounts.get(id) ?? 0) + 1);
    }
  }

  const chromeCatalog = cyberwareCatalog(data);
  const itemsCatalog: ReadonlyMap<string, ItemDef> =
    data.items !== undefined ? itemCatalog(data) : new Map<string, ItemDef>();

  // 抽取阶段系统层已有完整【物品表】与【义体表】，不再重复粘贴 5K 级候选清单，
  // 仅给出精简建卡原则、常见民用/街头基础义体速查与近期重复型号提醒。
  if (includeIds) {
    const staples = STAPLE_CHROME_IDS.flatMap((id) => {
      const def = chromeCatalog.get(id);
      return def ? [`${def.id} ${def.name}`] : [];
    });
    const repeatedItems = [...gearCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `${itemsCatalog.get(id)?.name ?? id}（${n} 人）`);
    const repeatedChrome = [...chromeCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `${chromeCatalog.get(id)?.name ?? id}（${n} 人）`);
    const repeats = [...repeatedItems, ...repeatedChrome];
    return [
      "【新人物装备选型提示】",
      "新建人物或定型「还没定」旧识时，直接从系统层【物品表】与【义体表】按身份、生计、财力与现场事实选配 body.gear（合身衣物 + 随身小物/武器，与 outfit 一致）与 body.cyberware（夜之城常态大多常配 1–3 件贴合身份的基础或专业义体，错开部位，不千篇一律只填单一义眼；仅正文明确无植入、信仰排斥或极端拮据者留空）。不朽与独立实物不作普通新人物配装；已有定型人物不借此补装或改配。",
      ...(staples.length > 0 ? [`常见基础/安防义体速查：${staples.join("、")}`] : []),
      ...(repeats.length > 0
        ? [`近期自创人物重复较多型号：${repeats.join("、")}（用途与财力相当时优先错开其他型号）。`]
        : []),
    ].join("\n");
  }

  const weapons: Candidate[] = [];
  const clothes: Candidate[] = [];
  const belongings: Candidate[] = [];
  for (const item of itemsCatalog.values()) {
    if (item.iconic || objects[item.id] || item.id.startsWith("wpn:")) continue;
    if (item.kind === "weapon") {
      const type = item.weaponType ? WEAPON_TYPE_LABELS[item.weaponType] : "近战";
      const note = summarizeAbility(item.ability, 24) || "常规武器";
      weapons.push({
        id: item.id,
        name: item.name,
        group: item.category ? WEAPON_CATEGORY_LABELS[item.category] : "其他武器",
        variant: `${type}:${budget(item.rarity)}`,
        line: `- ${item.name}（${type}/${budget(item.rarity)}）：${note}`,
      });
    } else if (item.kind === "clothing" && item.clothingSlot) {
      const note = summarizeAbility(item.ability, 24) || "常规穿着";
      const tierRole = item.protection ? "armored" : "casual";
      clothes.push({
        id: item.id,
        name: item.name,
        group: CLOTHING_SLOT_LABELS[item.clothingSlot],
        variant: `${tierRole}:${budget(item.rarity)}`,
        line: `- ${item.name}（${budget(item.rarity)}）：${note}`,
      });
    } else if (
      (item.kind === "healing" ||
        item.kind === "grenade" ||
        item.kind === "consumable" ||
        item.kind === "misc") &&
      !item.chipContentId
    ) {
      const subRole =
        item.kind !== "misc"
          ? item.kind
          : item.carryBonus
            ? "carry"
            : (item.hazards?.length ?? 0) > 0 || (item.stealthTags?.length ?? 0) > 0
              ? "tactical"
              : item.braindanceDevice || item.chipDevice
                ? "device"
                : "daily";
      const note = summarizeAbility(item.ability, 24) || "常见随身物件";
      belongings.push({
        id: item.id,
        name: item.name,
        group: ITEM_KIND_LABELS[item.kind],
        variant: `${subRole}:${budget(item.rarity)}`,
        line: `- ${item.name}：${note}`,
      });
    }
  }
  const chrome: Candidate[] = [];
  for (const part of chromeCatalog.values()) {
    if (part.iconic) continue;
    const family =
      part.slot !== "os"
        ? ""
        : part.deckTraits !== undefined
          ? "接入仓"
          : part.accelerator
            ? "斯安威斯坦"
            : "其他操作系统";
    const note = summarizeAbility(part.ability, 24) || "常规义体";
    chrome.push({
      id: part.id,
      name: part.name,
      group: SLOT_LABELS[part.slot],
      variant: `${family}:${budget(part.rarity)}`,
      line: `- ${part.name}（${RARITY_LABELS[part.rarity]}）：${note}`,
    });
  }
  if (
    weapons.length === 0 &&
    clothes.length === 0 &&
    belongings.length === 0 &&
    chrome.length === 0
  )
    return undefined;

  // 按每新增 5 名自创人物才轮换一次分桶代表，避免每轮因游戏分钟变化导致整段参考无谓抖动。
  const seed = `batch:${Math.floor(customMet.length / 5)}`;
  const clothingPicks = representatives(clothes, gearCounts, seed);
  const belongingPicks = representatives(belongings, gearCounts, seed);
  const weaponPicks = representatives(weapons, gearCounts, seed);
  const chromePicks = representatives(chrome, chromeCounts, seed);
  for (const stapleId of STAPLE_CHROME_IDS) {
    const part = chrome.find((entry) => entry.id === stapleId);
    if (part && !chromePicks.some((entry) => entry.id === part.id)) {
      chromePicks.push(part);
    }
  }
  const repeated = (candidates: readonly Candidate[], counts: ReadonlyMap<string, number>) =>
    candidates
      .filter((candidate) => (counts.get(candidate.id) ?? 0) >= 2)
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .slice(0, 5)
      .map((candidate) => `${candidate.name}（${counts.get(candidate.id)} 人）`);
  const repeats = [...repeated(weapons, gearCounts), ...repeated(chrome, chromeCounts)];
  const lead = [
    "【新人物装备创作参考】",
    "仅在首次引入重要新人物或尚未定型的旧识时供选型参考；夜之城人物通常装有贴合身份与财力的常见基础或专业义体（纯肉身属少数特例）。按身份、工作、财力和来源自然呈现衣着、随身物件、武器与义体，不逐件报清单，也不改写已定型人物的配置。",
  ];
  return [
    ...lead,
    ...(repeats.length > 0
      ? [
          `近期已见自创人物中重复的型号：${repeats.join("、")}。用途与财力相当时可考虑其他型号；常见装备仍可合理重复。`,
        ]
      : []),
    ...(clothingPicks.length > 0 ? [`常见服装参考\n${groupedLines(clothingPicks)}`] : []),
    ...(belongingPicks.length > 0
      ? [`随身物品参考（药剂、工具、日常物件）\n${groupedLines(belongingPicks)}`]
      : []),
    ...(weaponPicks.length > 0 ? [`武器参考\n${groupedLines(weaponPicks)}`] : []),
    ...(chromePicks.length > 0 ? [`义体参考\n${groupedLines(chromePicks)}`] : []),
  ].join("\n");
}
