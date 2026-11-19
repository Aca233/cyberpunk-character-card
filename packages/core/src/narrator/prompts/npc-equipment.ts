import type { WorldState } from "../../kernel/world";
import { cyberwareCatalog, SLOT_LABELS } from "../../systems/cyberware";
import { RARITY_LABELS, type Rarity } from "../../systems/economy";
import {
  InventoryStateSchema,
  itemCatalog,
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
  if (data.items !== undefined) {
    for (const item of itemCatalog(data).values()) {
      if (item.kind !== "weapon" || item.iconic || objects[item.id] || item.id.startsWith("wpn:"))
        continue;
      const type = item.weaponType ? WEAPON_TYPE_LABELS[item.weaponType] : "近战";
      weapons.push({
        id: item.id,
        name: item.name,
        group: item.category ? WEAPON_CATEGORY_LABELS[item.category] : "其他武器",
        variant: `${type}:${budget(item.rarity)}`,
        line: `- ${includeIds ? `${item.id} ` : ""}${item.name}（${type}，${budget(item.rarity)}，参考价 ${item.price ?? "未知"}）：${item.ability ?? "按实际武器结构使用"}`,
      });
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
    chrome.push({
      id: part.id,
      name: part.name,
      group: SLOT_LABELS[part.slot],
      variant: `${family}:${budget(part.rarity)}`,
      line: `- ${includeIds ? `${part.id} ` : ""}${part.name}（${RARITY_LABELS[part.rarity]}，参考价 ${part.price}）：${part.ability}`,
    });
  }
  if (weapons.length === 0 && chrome.length === 0) return undefined;

  const seed = `${world.time}:${npcs.length}`;
  const weaponPicks = representatives(weapons, gearCounts, seed);
  const chromePicks = representatives(chrome, chromeCounts, seed);
  // 智能枪的自导需要真实联锁，不能因本轮轮换隐藏其基础配套。
  const smartLink = chrome.find((part) => part.id === "smart-link");
  if (smartLink && !chromePicks.some((part) => part.id === smartLink.id))
    chromePicks.push(smartLink);
  const repeated = (candidates: readonly Candidate[], counts: ReadonlyMap<string, number>) =>
    candidates
      .filter((candidate) => (counts.get(candidate.id) ?? 0) >= 2)
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .slice(0, 5)
      .map((candidate) => `${candidate.name}（${counts.get(candidate.id)} 人）`);
  const repeats = [...repeated(weapons, gearCounts), ...repeated(chrome, chromeCounts)];
  return [
    "【新人物装备选型参考】",
    "先确定这个人靠什么吃饭、怎样应付危险、买得起或从何得到装备，再按用途选武器与植入物。基础义眼不是人人必填的默认配置；没有植入需求或已明确无义体的人可以不装。专业战斗人员、黑客、技工、搬运工、潜入者的配置应体现各自工作与经历。",
    "以下按武器门类、义体部位及预算/体系抽取代表，带真实能力；只是参考，不是白名单，也不是逐组配齐的清单。顶级件需要相称的身份和来源，不能因候选里有就给普通路人。参考价只帮助把握财力，不是现货或成交授权；不朽与独立实物不作为普通新人物的随机配装。",
    "明确型号、已装能力与既有卡面优先；同伙可有制式共性，同轮新人物按职责分工，不无理由复制同一整套。智能武器的自导须有真实智能联锁；接入仓、斯安威斯坦、狂暴共享一个操作系统位置，其余遵守部位容量。",
    "只在新建人物或允许定型的未定人物初始化时用于选型；已有空义体栏也可能是确认的无植入，不能见到参考就补装或换装。未在正文暴露的植入物是幕后事实，玩家须有观察、告知或扫描来源才能知道；正文按实际需要表现装备，不逐件报清单。",
    ...(repeats.length > 0
      ? [
          `近期已见自创人物中重复的型号：${repeats.join("、")}。用途与财力相当时可考虑其他型号；常见装备仍可合理重复。`,
        ]
      : []),
    ...(weaponPicks.length > 0 ? [`武器候选\n${groupedLines(weaponPicks)}`] : []),
    ...(chromePicks.length > 0 ? [`义体候选\n${groupedLines(chromePicks)}`] : []),
  ].join("\n");
}
