import type { WorldState } from "../../kernel/world";
import { cyberwareCatalog, SLOT_LABELS } from "../../systems/cyberware";
import { RARITY_LABELS, type Rarity } from "../../systems/economy";
import {
  CLOTHING_SLOT_LABELS,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
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

/** 新人物的装备创作与建卡共用真实目录的用途参考，不改动任何人物或物件状态。 */
export function npcEquipmentReference(
  world: WorldState,
  data: Readonly<Record<string, unknown>> | undefined,
  includeIds = false,
): string | undefined {
  if (!data) return undefined;
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc ?? {}).npcs);
  // 未见过的原作人物不是模型最近的配装选择，不能拿内容包的默认配置惩罚常见型号。
  const recent = npcs
    .filter((npc) => npc.met && !npc.canon)
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

  const weapons: Candidate[] = [];
  const clothes: Candidate[] = [];
  const belongings: Candidate[] = [];
  if (data.items !== undefined) {
    for (const item of itemCatalog(data).values()) {
      if (item.iconic || objects[item.id] || item.id.startsWith("wpn:")) continue;
      if (item.kind === "weapon") {
        const type = item.weaponType ? WEAPON_TYPE_LABELS[item.weaponType] : "近战";
        const note = summarizeAbility(item.ability, 36) || "按实际武器结构使用";
        weapons.push({
          id: item.id,
          name: item.name,
          group: item.category ? WEAPON_CATEGORY_LABELS[item.category] : "其他武器",
          variant: `${type}:${budget(item.rarity)}`,
          line: `- ${includeIds ? `${item.id} ` : ""}${item.name}（${type}，${budget(item.rarity)}，参考价 ${item.price ?? "未知"}）：${note}`,
        });
      } else if (item.kind === "clothing" && item.clothingSlot) {
        const note = summarizeAbility(item.ability, 36) || "常规穿着";
        const tierRole = item.protection ? "armored" : "casual";
        clothes.push({
          id: item.id,
          name: item.name,
          group: CLOTHING_SLOT_LABELS[item.clothingSlot],
          variant: `${tierRole}:${budget(item.rarity)}`,
          line: `- ${includeIds ? `${item.id} ` : ""}${item.name}（${budget(item.rarity)}，参考价 ${item.price ?? "未知"}）：${note}`,
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
        const note = summarizeAbility(item.ability, 36) || "常见随身物品";
        belongings.push({
          id: item.id,
          name: item.name,
          group: ITEM_KIND_LABELS[item.kind],
          variant: `${subRole}:${budget(item.rarity)}`,
          line: `- ${includeIds ? `${item.id} ` : ""}${item.name}（参考价 ${item.price ?? "未知"}）：${note}`,
        });
      }
    }
  }
  const chrome: Candidate[] = [];
  for (const part of cyberwareCatalog(data).values()) {
    if (part.iconic) continue;
    const family =
      part.slot !== "os"
        ? ""
        : part.deckTraits !== undefined
          ? "接入仓"
          : part.accelerator
            ? "斯安威斯坦"
            : "其他操作系统";
    const note = summarizeAbility(part.ability, 36) || "常规义体";
    chrome.push({
      id: part.id,
      name: part.name,
      group: SLOT_LABELS[part.slot],
      variant: `${family}:${budget(part.rarity)}`,
      line: `- ${includeIds ? `${part.id} ` : ""}${part.name}（${RARITY_LABELS[part.rarity]}，参考价 ${part.price}）：${note}`,
    });
  }
  if (
    weapons.length === 0 &&
    clothes.length === 0 &&
    belongings.length === 0 &&
    chrome.length === 0
  )
    return undefined;

  const seed = `${world.time}:${npcs.length}`;
  const clothingPicks = representatives(clothes, gearCounts, seed);
  const belongingPicks = representatives(belongings, gearCounts, seed);
  const weaponPicks = representatives(weapons, gearCounts, seed);
  const chromePicks = representatives(chrome, chromeCounts, seed);
  // 夜之城最常见的基础民用/街头义体与智能联锁常驻参考，避免被轮换隐藏后模型只能留空或误选偏门战术件。
  const stapleChromeIds = [
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
  ];
  for (const stapleId of stapleChromeIds) {
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
  const lead = includeIds
    ? [
        "【新人物装备选型参考】",
        "由你根据人物事实推演配装，不套职业模板：先判断人物靠什么能力工作、日常穿着与随身携带什么物件、怎样应付风险，再结合经历、财力和来源，按目录能力选衣物、随身物品、武器与义体。普通市民、商贩或文职也会穿着合身衣物并携带日常小物或应急药剂，不因不持枪就把 gear 留空；在夜之城，大多数人日常都常配 1–3 件贴合身份、生计与财力的基础或常见义体（例如普通市民、商贩、雇员与中间人可按生活与工作习惯选基础岐路司义眼、生物监测、合成肺叶、持握衬垫、通用义肢或防火/接地镀层，街头与专业从业者再搭配相应部位的接入仓、皮下护甲、神经或骨骼/手腿件）；只有正文明确无植入、信仰排斥义体或极端拮据的人才留空。不同人物优先按工作与习惯错开部位，不要千篇一律只填同一款义眼。",
        "以下按服装部位、随身物品、武器门类及义体部位抽取代表，并常驻常见基础义体，带真实用途；只是参考，不是白名单，也不是逐组配齐的清单。顶级件需要相称的身份和来源，不能因候选里有就给普通路人。参考价只帮助把握财力，不是现货或成交授权；不朽与独立实物不作为普通新人物的随机配装。",
        "明确型号、已装能力与既有卡面优先；同伙可有制式共性，同轮新人物按职责分工，不无理由复制同一整套。智能武器的自导须有真实智能联锁；接入仓、斯安威斯坦、狂暴共享一个操作系统位置，其余遵守部位容量。",
        "只在新建人物或允许定型的未定人物初始化时用于选型；已有空义体栏也可能是确认的无植入，不能见到参考就补装或换装。",
      ]
    : [
        "【新人物装备创作参考】",
        "仅在首次引入重要新人物或尚未定型的旧识时供选型参考；夜之城人物通常装有贴合身份与财力的常见基础或专业义体（纯肉身属少数特例）。不套职业模板，按身份、工作、财力和来源自然呈现衣着、随身物件、武器与义体，不逐件报清单，也不改写已定型人物的配置。",
      ];
  return [
    ...lead,
    ...(repeats.length > 0
      ? [
          `近期已见自创人物中重复的型号：${repeats.join("、")}。用途与财力相当时可考虑其他型号；常见装备仍可合理重复。`,
        ]
      : []),
    ...(clothingPicks.length > 0
      ? [
          `${includeIds ? "服装候选（写入 body.gear，与 outfit 一致）" : "常见服装参考"}\n${groupedLines(clothingPicks)}`,
        ]
      : []),
    ...(belongingPicks.length > 0
      ? [
          `${includeIds ? "随身物品候选（药剂、工具、日常物件，写入 body.gear）" : "随身物品参考（药剂、工具、日常物件）"}\n${groupedLines(belongingPicks)}`,
        ]
      : []),
    ...(weaponPicks.length > 0 ? [`武器参考\n${groupedLines(weaponPicks)}`] : []),
    ...(chromePicks.length > 0 ? [`义体参考\n${groupedLines(chromePicks)}`] : []),
  ].join("\n");
}
