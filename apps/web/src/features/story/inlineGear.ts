import { cyberware as CONTENT_CYBERWARE, items as CONTENT_ITEMS } from "@cp/content";
import { cyberwareRules, economyRules, inventoryRules } from "@cp/core";
import type { GearArtId } from "../../assets/customArt";
import { itemArtOf } from "./art";
import type { View } from "./view";

export type InlineGearKind = "weapon" | "cyberware";

export interface InlineGearItem {
  readonly id: string;
  readonly kind: InlineGearKind;
  readonly name: string;
  readonly categoryLabel: string;
  readonly rarity?: economyRules.Rarity | undefined;
  readonly rarityLabel?: string | undefined;
  readonly iconic?: boolean | undefined;
  readonly weaponTypeLabel?: string | undefined;
  readonly ability: string;
  readonly statusTag?: string | undefined;
  readonly art?: GearArtId | undefined;
  readonly aliases?: readonly string[] | undefined;
}

export interface GearMatcher {
  readonly pattern: RegExp;
  readonly byTerm: ReadonlyMap<string, InlineGearItem>;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 容易与日常中文词碰撞的通用名称：
 * 仅作精确武器名时容易在普通旁白里误伤（例如“混乱的街道”“守护着他”“骄傲/傲慢”“突破防线”“小刀”等）。
 * 注意：如果玩家自己当前正持有或装备着这件物品/义体，可按上下文单独放行；
 * 否则对全局图鉴里的这类高频日常词跳过自动匹配，避免把普通动词/形容词误标成武器或义体。
 */
const AMBIGUOUS_GLOBAL_TERMS = new Set([
  "丽姿",
  "混乱",
  "傲慢",
  "退路",
  "守望",
  "突破",
  "守护",
  "觉",
  "零五",
  "铁胆",
  "真探",
  "终夜",
  "金刚",
  "白虎",
  "补牢",
  "正宗",
  "风暴",
  "新星",
  "脉冲",
  "快刀",
  "小刀",
  "砍刀",
  "锤子",
  "扳手",
  "钢管",
  "撬棍",
  "战斧",
  "河童",
  "时雨",
  "野分",
  "本影",
  "九尾",
  "玉响",
  "应龙",
  "罗刹",
  "尖桩",
  "暴风雪",
  "硬骨头",
  "要人命",
  "魔爪",
  "金棒",
  "一拳开",
  "百拳开",
  "死不鸟",
  "风险规避",
  "全域覆盖",
  "思想防线",
  "击杀治疗",
  "生物监测",
  "智能连接",
  "机动系统",
  "外接盘",
  "自我 ICE",
  "内存加强",
  "视觉皮质支持",
  "边缘系统增强",
  "反应调谐器",
  "瞬时感知",
  "电磁回收",
  "坚矛利盾",
  "等距稳定",
  "细胞适配",
  "通用增强件",
  "省力减震",
]);

/** 从“型号 名称”拆出常用简称（如 `M-10AF 莱克星顿` -> `莱克星顿`），避免正文只写后半段时扫不到 */
function derivedAliases(name: string): string[] {
  const out: string[] = [];
  const trimmed = name.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    const prefix = trimmed.slice(0, spaceIdx).trim();
    const tail = trimmed.slice(spaceIdx + 1).trim();
    // 只有前缀像型号代号（含字母或数字）且后半段足够独特（>=2 字）时，把后半段当别名
    if (/[A-Za-z0-9]/.test(prefix) && [...tail].length >= 2 && !AMBIGUOUS_GLOBAL_TERMS.has(tail)) {
      out.push(tail);
    }
  }
  // 去掉书名号/双引号的常见简写，例如 岐路司义眼“千里目”
  const quoteMatch = /[“「]([^”」]{2,})[”」]/.exec(trimmed);
  if (quoteMatch?.[1] && !AMBIGUOUS_GLOBAL_TERMS.has(quoteMatch[1])) {
    const bare = trimmed.replace(/[“”「」]/g, "");
    if (bare !== trimmed) out.push(bare);
  }
  return out;
}

const WEAPON_TYPE_LABELS: Readonly<Record<string, string>> = {
  power: "动能",
  tech: "技术",
  smart: "智能",
};

function rarityText(rarity?: economyRules.Rarity, iconic?: boolean): string | undefined {
  const base = rarity ? economyRules.RARITY_LABELS[rarity] : undefined;
  if (iconic) return base ? `不朽 · ${base}` : "不朽";
  return base;
}

interface BaseCatalog {
  readonly items: readonly InlineGearItem[];
  readonly byId: ReadonlyMap<string, InlineGearItem>;
}

let cachedCatalog: BaseCatalog | null = null;

function baseCatalog(): BaseCatalog {
  if (cachedCatalog) return cachedCatalog;
  const list: InlineGearItem[] = [];
  const byId = new Map<string, InlineGearItem>();

  for (const item of CONTENT_ITEMS) {
    if (item.kind !== "weapon") continue;
    const categoryLabel = item.category
      ? (inventoryRules.WEAPON_CATEGORY_LABELS[item.category] ?? "武器")
      : "武器";
    const entry: InlineGearItem = {
      id: item.id,
      kind: "weapon",
      name: item.name,
      categoryLabel,
      rarity: item.rarity,
      rarityLabel: rarityText(item.rarity, item.iconic),
      iconic: item.iconic,
      weaponTypeLabel: item.weaponType ? WEAPON_TYPE_LABELS[item.weaponType] : undefined,
      ability: item.ability ?? "常规夜之城武器。",
      art: itemArtOf(item.id),
      aliases: derivedAliases(item.name),
    };
    list.push(entry);
    byId.set(entry.id, entry);
  }

  for (const cw of CONTENT_CYBERWARE) {
    const slotLabel = cyberwareRules.SLOT_LABELS[cw.slot] ?? "义体";
    const entry: InlineGearItem = {
      id: cw.id,
      kind: "cyberware",
      name: cw.name,
      categoryLabel: `${slotLabel}义体`,
      rarity: cw.rarity,
      rarityLabel: rarityText(cw.rarity, cw.iconic),
      iconic: cw.iconic,
      ability: cw.ability,
      art: itemArtOf(cw.id),
      aliases: derivedAliases(cw.name),
    };
    list.push(entry);
    byId.set(entry.id, entry);
  }

  cachedCatalog = { items: list, byId };
  return cachedCatalog;
}

function registerTerm(
  map: Map<string, InlineGearItem>,
  term: string,
  entry: InlineGearItem,
  blockedNames: ReadonlySet<string>,
  allowAmbiguous: boolean,
): void {
  const clean = term.trim();
  if ([...clean].length < 2) return;
  if (blockedNames.has(clean)) return;
  if (!allowAmbiguous && AMBIGUOUS_GLOBAL_TERMS.has(clean)) return;
  if (!map.has(clean)) map.set(clean, entry);
}

/**
 * 构建当前存档正文用的武器/义体行内匹配器：
 * 1) 优先合并玩家当前持有/装备的武器、已安装/随身义体与当前诊所/商店条目（含自定义命名与状态标注）；
 * 2) 补齐全局官方武器与义体图鉴（自动过滤高频日常词，避免误伤普通旁白）；
 * 3) 排除与角色名/地名重名的词条（例如不朽手枪“丽姿”不抢占地点或人名）。
 */
export function buildGearMatcher(
  view: View,
  blockedNames: ReadonlySet<string>,
): GearMatcher | null {
  const { items: catalogItems, byId } = baseCatalog();
  const byTerm = new Map<string, InlineGearItem>();

  // 1. 玩家已安装义体（带状态标签）
  for (const cw of view.cyberware) {
    const base = byId.get(cw.id);
    const rarity = cw.rarity ?? base?.rarity;
    const entry: InlineGearItem = {
      id: cw.id,
      kind: "cyberware",
      name: cw.name,
      categoryLabel: `${cw.slotLabel}义体`,
      rarity,
      rarityLabel: rarityText(rarity, cw.iconic),
      iconic: cw.iconic,
      ability: cw.ability ?? base?.ability ?? "已安装的赛博义体。",
      statusTag: cw.broken ? "已装 · 损毁" : "已安装",
      art: itemArtOf(cw.id),
    };
    registerTerm(byTerm, cw.name, entry, blockedNames, true);
    for (const alias of base?.aliases ?? []) {
      registerTerm(byTerm, alias, entry, blockedNames, false);
    }
  }

  // 2. 玩家背包中持有的武器
  for (const [itemId, count] of Object.entries(view.inventory.backpack)) {
    if (count <= 0) continue;
    const detail = view.inventory.details[itemId];
    if (detail?.kind !== "weapon") continue;
    const baseId = detail.baseId ?? itemId;
    const base = byId.get(baseId);
    const name = view.names.items[itemId] ?? base?.name ?? itemId;
    const rarity = detail.rarity ?? base?.rarity;
    const iconic = detail.iconic || base?.iconic;
    const entry: InlineGearItem = {
      id: itemId,
      kind: "weapon",
      name,
      categoryLabel: detail.subLabel || base?.categoryLabel || "武器",
      rarity,
      rarityLabel: rarityText(rarity, iconic),
      iconic,
      weaponTypeLabel: detail.subLabel ? undefined : base?.weaponTypeLabel,
      ability: detail.ability || base?.ability || "随身携带的武器。",
      statusTag: "随身持有",
      art: itemArtOf(itemId) ?? base?.art,
    };
    registerTerm(byTerm, name, entry, blockedNames, true);
    for (const alias of base?.aliases ?? []) {
      registerTerm(byTerm, alias, entry, blockedNames, false);
    }
  }

  // 3. 当前在场义体医生货架与商店里的武器（若尚未登记，优先使用带实时字段的版本）
  if (view.ripperdoc) {
    for (const shelf of view.ripperdoc.shelf) {
      const base = byId.get(shelf.id);
      const entry: InlineGearItem = {
        id: shelf.id,
        kind: "cyberware",
        name: shelf.name,
        categoryLabel: `${shelf.slotLabel}义体`,
        rarity: shelf.rarity,
        rarityLabel: rarityText(shelf.rarity, shelf.iconic),
        iconic: shelf.iconic,
        ability: shelf.ability || base?.ability || "义体医生在售义体。",
        statusTag: shelf.installed ? "已安装" : "诊所在售",
        art: itemArtOf(shelf.id),
      };
      registerTerm(byTerm, shelf.name, entry, blockedNames, false);
    }
  }

  // 4. 全局图鉴兜底（正文提到的任意原作武器/义体都能亮色并出悬浮卡）
  for (const item of catalogItems) {
    registerTerm(byTerm, item.name, item, blockedNames, false);
    for (const alias of item.aliases ?? []) {
      registerTerm(byTerm, alias, item, blockedNames, false);
    }
  }

  // 通用高频义体大类俗称（正文常写“斯安威斯坦”“岐路司义眼”而非完整型号）
  const genericCyberware: readonly InlineGearItem[] = [
    {
      id: "zetatech-sandevistan",
      kind: "cyberware",
      name: "斯安威斯坦",
      categoryLabel: "操作系统义体",
      rarity: "epic",
      rarityLabel: "军用反射加速",
      ability:
        "植入脊柱的神经反射加速系统。开启后大幅压低主观时间流速，让使用者在旁人来不及抬枪的瞬间完成拔枪、换位或近身制敌；连续超频会剧烈冲击神经耐受。",
      art: itemArtOf("dynalar-sandevistan"),
    },
    {
      id: "kiroshi-mk1",
      kind: "cyberware",
      name: "岐路司义眼",
      categoryLabel: "眼部义体",
      rarity: "uncommon",
      rarityLabel: "光学扫描植入体",
      ability:
        "岐路司光学出品的赛博义眼系列，内置实时 HUD、目标识别、通缉档案与硬件扫描功能，是夜之城佣兵最常见的视觉植入体。",
      art: itemArtOf("kiroshi-mk1"),
    },
    {
      id: "militech-paraline",
      kind: "cyberware",
      name: "网络接入仓",
      categoryLabel: "操作系统义体",
      rarity: "rare",
      rarityLabel: "黑客接口系统",
      ability:
        "黑客专用神经操作系统，提供可编程 RAM 与加密链路接口，用于现场上传快速破解、绕过子网 ICE 或执行入侵协议。",
      art: itemArtOf("militech-paraline"),
    },
  ];
  for (const g of genericCyberware) {
    registerTerm(byTerm, g.name, g, blockedNames, true);
  }

  if (byTerm.size === 0) return null;
  const terms = [...byTerm.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return {
    pattern: new RegExp(`(${terms.join("|")})`, "g"),
    byTerm,
  };
}

export interface GearSegment {
  readonly text: string;
  readonly gear?: InlineGearItem | undefined;
}

/** 把一段普通正文切分成普通文字和已识别的武器/义体 */
export function splitGear(text: string, matcher: GearMatcher | null | undefined): GearSegment[] {
  if (!matcher) return [{ text }];
  return text
    .split(matcher.pattern)
    .filter((part) => part !== "")
    .map((part) => {
      const gear = matcher.byTerm.get(part);
      return gear ? { text: part, gear } : { text: part };
    });
}
