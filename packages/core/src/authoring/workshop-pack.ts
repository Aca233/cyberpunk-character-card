import { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage } from "../kernel/ports";
import { type WorkshopPack, WorkshopPackSchema } from "../schemas/workshop";
import { cyberwareExclusiveGroup } from "../systems/cyberware/schema";

export const WORKSHOP_GENERATE_FOCUSES = [
  "auto",
  "cyberware",
  "items",
  "modules",
  "npcs",
  "mixed",
] as const;
export type WorkshopGenerateFocus = (typeof WORKSHOP_GENERATE_FOCUSES)[number];

export const WorkshopGenerateRequestSchema = z.strictObject({
  prompt: z.string().trim().min(4, "请多写几句想法再让 AI 生成").max(1200, "描述最多 1200 字"),
  focus: z.enum(WORKSHOP_GENERATE_FOCUSES).default("auto"),
  author: z.string().trim().max(40).default(""),
});
export type WorkshopGenerateRequest = z.infer<typeof WorkshopGenerateRequestSchema>;

export type WorkshopGenerateResult =
  | { readonly ok: true; readonly pack: WorkshopPack }
  | { readonly ok: false; readonly error: string; readonly blocked?: boolean };

const VALID_SLOTS = new Set([
  "frontalCortex",
  "eyes",
  "nervous",
  "os",
  "circulatory",
  "integumentary",
  "skeleton",
  "hands",
  "arms",
  "legs",
]);

const VALID_CATEGORIES = new Set([
  "chassis",
  "cyberdeck",
  "spineDrive",
  "optics",
  "arms",
  "legDrive",
  "skinArmor",
  "neural",
  "sensory",
  "torso",
  "extremities",
  "lifestyle",
]);

const VALID_RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary"]);
const VALID_ITEM_KINDS = new Set([
  "weapon",
  "healing",
  "grenade",
  "consumable",
  "clothing",
  "mod",
  "misc",
]);
const VALID_WEAPON_CATS = new Set([
  "pistol",
  "revolver",
  "smg",
  "assaultRifle",
  "shotgun",
  "precisionRifle",
  "sniperRifle",
  "lmg",
  "blade",
  "blunt",
]);
const MELEE_CATS = new Set(["blade", "blunt"]);
const VALID_SHOPS = new Set([
  "wilson",
  "kabuki-arms",
  "japantown-arcade",
  "vik-pharmacy",
  "sleeve-corner",
  "lizzies-bar-bd",
  "jigjig-xbd-stall",
]);
const VALID_RIPPERDOCS = new Set(["viktor", "charles-bucks"]);

const FOCUS_HINT: Readonly<Record<WorkshopGenerateFocus, string>> = {
  auto: "根据玩家需求自由搭配最合适的内容类型（通常 2–6 条精选条目，质量优先，不必凑数）。",
  cyberware: "重点生成 2–4 件极具赛博朋克质感的义体，并视定位上架到 viktor 或 charles-bucks 诊所。",
  items: "重点生成 2–4 件特色武器、服装或装备，并视定位上架到合适商店。",
  modules: "重点生成 2–4 条创角主板模块（出身 origin / 特质 skill / 过往 past / 缺陷 flaw）。",
  npcs: "重点生成 1–3 位立体丰满的原创夜之城人物（含外貌、口吻、诉求、底线、幕后秘密）并写入 seedNpcs。",
  mixed: "综合生成一套完整主题扩展包：1–2 件义体 + 1–2 件武器/物品 + 1–2 条模块 + 1 位原创人物。",
};

function buildPrompt(req: WorkshopGenerateRequest): LlmMessage[] {
  const system = [
    "你是《赛博朋克 2091》创意工坊的内容设计师。根据玩家的想法，一次性生成一个可直接导入游戏的合法 v2 内容包 JSON。",
    "只输出单个纯 JSON 对象，不要 Markdown 代码块，不要任何前后解释文字。",
    "所有文本用自然流畅的中文，贴合夜之城世界观；绝不编造固定伤害百分比或属性加减公式，能力描述聚焦具体机制、质感与叙事效果。",
    "规则与字段格式：",
    '- 顶层字段：format="cp2077-workshop-pack", version=2, id（4–20位小写英文/数字/连字符）, title（≤40字）, author（≤40字）, description（≤280字）, modules, acquaintances, npcs, seedNpcs, items, cyberware, braindances, chipContents, shopListings, ripperdocListings。',
    "- 所有条目 id 必须为 1–30 位小写英文、数字和连字符（如 mantis-pulse），且整个内容包内所有条目 id 全局不重复。",
    "- cyberware 每项必填：id, name, slot（frontalCortex/eyes/nervous/os/circulatory/integumentary/skeleton/hands/arms/legs）, category（chassis/cyberdeck/spineDrive/optics/arms/legDrive/skinArmor/neural/sensory/torso/extremities/lifestyle）, rarity（common/uncommon/rare/epic/legendary）, price（正整数，如 8000–75000）, humanityCost（0–20整数，lifestyle 为 0）, armor（布尔）, accelerator（布尔）, iconic（false）, ability（中文具体能力描述）；手臂件可加 defaultArmSide（left/right/both），接入仓加 deckProfile。",
    "- items 每项必填：id, name, kind（weapon/healing/grenade/consumable/clothing/mod/misc）, rarity, price（整数）, iconic（布尔）, ability；weapon 必填 category（pistol/revolver/smg/assaultRifle/shotgun/precisionRifle/sniperRifle/lmg/blade/blunt），远程武器填 weaponType（power/tech/smart），近战(blade/blunt)绝不填 weaponType；clothing 必填 clothingSlot（head/face/outer/inner/legs/feet）；healing 必填 charges 与 healPercent；grenade 必填 charges。",
    "- modules 每项必填：id, slot（origin/past/skill/flaw）, label（≤24字）, tags（1–4个短中文标签）, ability（≤200字）, hook（≤200字）, people（[]）, custom（true）。",
    "- npcs 每项必填：id, name, pronoun（他/她/TA）, role, faction（none 或 maelstrom/tyger-claws/valentinos/sixth-street/animals/voodoo-boys/mox/aldecaldos/arasaka/militech/netwatch/ncpd/barghest）, look, outfit, voice, samples（1–2句台词）, want, limit, secret, canon（false）, hangouts（[]）。希望开局在城内出场则把该 npc 的 id 加入 seedNpcs。",
    "- shopListings 每项：{shop, item, stock}，shop 只能从 wilson / kabuki-arms / japantown-arcade / vik-pharmacy / sleeve-corner 选，item 必须是本包 items 的 id。",
    "- ripperdocListings 每项：{ripperdoc, cyberware, stock}，ripperdoc 只能从 viktor / charles-bucks 选，cyberware 必须是本包 cyberware 的 id。",
    `创作重点：${FOCUS_HINT[req.focus]}`,
  ].join("\n");

  const user = [`玩家需求：${req.prompt}`, req.author ? `创作者署名：${req.author}` : ""]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function slugifyId(raw: unknown, prefix: string, maxLen: number, used: Set<string>): string {
  const baseText = typeof raw === "string" ? raw : "";
  const cleaned = baseText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen - 4);
  let id = cleaned || `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
  id = id.slice(0, maxLen).replace(/-+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    id = `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
  }
  let n = 2;
  let candidate = id;
  while (used.has(candidate)) {
    const suffix = `-${n}`;
    candidate = `${id.slice(0, maxLen - suffix.length).replace(/-+$/g, "")}${suffix}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function slotForCategory(category: string): string {
  switch (category) {
    case "chassis":
      return "skeleton";
    case "cyberdeck":
    case "spineDrive":
      return "os";
    case "optics":
    case "sensory":
      return "eyes";
    case "arms":
      return "arms";
    case "legDrive":
      return "legs";
    case "skinArmor":
    case "lifestyle":
      return "integumentary";
    case "neural":
      return "frontalCortex";
    case "torso":
      return "circulatory";
    case "extremities":
      return "hands";
    default:
      return "arms";
  }
}

function asObj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, fallback = "", max = 200): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

/** 将模型产出的原始对象做安全归一化，修正常见字段小瑕疵后交给 WorkshopPackSchema 严格校验 */
export function normalizeGeneratedWorkshopPack(
  raw: Record<string, unknown>,
  fallbackAuthor: string,
): WorkshopPack | null {
  const usedIds = new Set<string>();
  const idMap = new Map<string, string>();
  const packIdSet = new Set<string>();
  const packId = slugifyId(raw.id, "ai-pack", 22, packIdSet);

  const cyberware: unknown[] = [];
  for (const entry of asArr(raw.cyberware)) {
    const o = asObj(entry);
    if (!o) continue;
    const name = str(o.name, "", 40);
    if (!name) continue;
    const origId = typeof o.id === "string" ? o.id.trim() : "";
    const id = slugifyId(origId || name, "cw", 30, usedIds);
    if (origId) idMap.set(origId, id);
    const category = VALID_CATEGORIES.has(String(o.category)) ? String(o.category) : undefined;
    const slot = VALID_SLOTS.has(String(o.slot))
      ? String(o.slot)
      : category
        ? slotForCategory(category)
        : "arms";
    const rarity = VALID_RARITIES.has(String(o.rarity)) ? String(o.rarity) : "rare";
    const armor = Boolean(o.armor) || category === "skinArmor";
    const accelerator = Boolean(o.accelerator) || category === "spineDrive";
    const deckProfile =
      typeof o.deckProfile === "string" && o.deckProfile.trim()
        ? o.deckProfile.trim().slice(0, 80)
        : category === "cyberdeck"
          ? "定制快速破解接口"
          : undefined;
    const exclusiveGroup = cyberwareExclusiveGroup({
      id,
      name,
      slot: slot as Parameters<typeof cyberwareExclusiveGroup>[0]["slot"],
      ...(category
        ? { category: category as Parameters<typeof cyberwareExclusiveGroup>[0]["category"] }
        : {}),
      armor,
      accelerator,
      ...(deckProfile ? { deckProfile } : {}),
    });
    cyberware.push({
      id,
      name,
      slot,
      ...(category ? { category } : {}),
      ...(exclusiveGroup ? { exclusiveGroup } : {}),
      ...(o.defaultArmSide === "left" || o.defaultArmSide === "right" || o.defaultArmSide === "both"
        ? { defaultArmSide: o.defaultArmSide }
        : {}),
      ...(o.smartLink ? { smartLink: true } : {}),
      ...(deckProfile ? { deckProfile, deckTraits: [] } : {}),
      rarity,
      price: num(o.price, 18000, 500, 500000),
      humanityCost: category === "lifestyle" ? 0 : num(o.humanityCost, 6, 0, 20),
      armor,
      accelerator,
      iconic: false,
      ability: str(o.ability, `${name}：定制赛博义体模块。`, 300),
    });
  }

  const items: unknown[] = [];
  for (const entry of asArr(raw.items)) {
    const o = asObj(entry);
    if (!o) continue;
    const name = str(o.name, "", 40);
    if (!name) continue;
    const origId = typeof o.id === "string" ? o.id.trim() : "";
    const id = slugifyId(origId || name, "item", 30, usedIds);
    if (origId) idMap.set(origId, id);
    const kind = VALID_ITEM_KINDS.has(String(o.kind)) ? String(o.kind) : "misc";
    const rarity = VALID_RARITIES.has(String(o.rarity)) ? String(o.rarity) : "rare";
    const out: Record<string, unknown> = {
      id,
      name,
      kind,
      rarity,
      price: num(o.price, 5000, 0, 500000),
      iconic: Boolean(o.iconic),
      ...(str(o.ability, "", 300) ? { ability: str(o.ability, "", 300) } : {}),
    };
    if (kind === "weapon") {
      const cat = VALID_WEAPON_CATS.has(String(o.category)) ? String(o.category) : "pistol";
      out.category = cat;
      if (!MELEE_CATS.has(cat)) {
        out.weaponType =
          o.weaponType === "tech" || o.weaponType === "smart" ? o.weaponType : "power";
      }
    } else if (kind === "clothing") {
      const slots = new Set(["head", "face", "outer", "inner", "legs", "feet"]);
      out.clothingSlot = slots.has(String(o.clothingSlot)) ? String(o.clothingSlot) : "outer";
    } else if (kind === "healing") {
      out.charges = num(o.charges, 3, 1, 20);
      out.healPercent = num(o.healPercent, 40, 5, 100);
    } else if (kind === "grenade") {
      out.charges = num(o.charges, 3, 1, 20);
    } else if (kind === "mod") {
      out.modSlot = o.modSlot === "muzzle" || o.modSlot === "scope" ? o.modSlot : "plugin";
      out.modFits = ["pistol"];
    }
    items.push(out);
  }

  const modules: unknown[] = [];
  for (const entry of asArr(raw.modules)) {
    const o = asObj(entry);
    if (!o) continue;
    const label = str(o.label, "", 24);
    if (!label) continue;
    const slot =
      o.slot === "origin" || o.slot === "past" || o.slot === "skill" || o.slot === "flaw"
        ? o.slot
        : "skill";
    const id = slugifyId(o.id || label, slot, 30, usedIds);
    const tags = asArr(o.tags)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 12))
      .slice(0, 6);
    modules.push({
      id,
      slot,
      label,
      tags,
      ability: str(o.ability, "", 200),
      hook: str(o.hook, "", 200),
      people: [],
      custom: true,
    });
  }

  const npcs: unknown[] = [];
  const npcIdSet = new Set<string>();
  for (const entry of asArr(raw.npcs)) {
    const o = asObj(entry);
    if (!o) continue;
    const name = str(o.name, "", 20);
    const role = str(o.role, "", 64);
    if (!name || !role) continue;
    const origId = typeof o.id === "string" ? o.id.trim() : "";
    const id = slugifyId(origId || name, "npc", 30, usedIds);
    if (origId) idMap.set(origId, id);
    npcIdSet.add(id);
    const samples = asArr(o.samples)
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 150))
      .slice(0, 3);
    npcs.push({
      id,
      name,
      ...(str(o.alias, "", 20) ? { alias: str(o.alias, "", 20) } : {}),
      pronoun: str(o.pronoun, "TA", 4),
      role,
      faction: str(o.faction, "none", 30),
      look: str(o.look, `${role}体态，带有鲜明夜之城街区特征与义体印记。`, 260),
      ...(str(o.outfit, "", 160) ? { outfit: str(o.outfit, "", 160) } : {}),
      voice: str(o.voice, "语速克制，带着夜之城老手的干练分寸。", 240),
      samples,
      want: str(o.want, `在夜之城保住自己的${role}立足之地。`, 220),
      limit: str(o.limit, "绝不出卖自己人，也不接毫无退路的死活。", 220),
      ...(str(o.secret, "", 240) ? { secret: str(o.secret, "", 240) } : {}),
      canon: false,
      hangouts: [],
    });
  }

  const seedNpcs = [
    ...new Set(
      asArr(raw.seedNpcs)
        .filter((s): s is string => typeof s === "string")
        .map((s) => idMap.get(s.trim()) ?? s.trim())
        .filter((id) => npcIdSet.has(id)),
    ),
  ];

  const validItemIds = new Set(items.map((i) => (i as { readonly id: string }).id));
  const validCwIds = new Set(cyberware.map((c) => (c as { readonly id: string }).id));

  const shopListings: { shop: string; item: string; stock: number }[] = [];
  const seenShopKey = new Set<string>();
  for (const entry of asArr(raw.shopListings)) {
    const o = asObj(entry);
    if (!o) continue;
    const shop = str(o.shop, "", 80);
    const item = idMap.get(str(o.item, "", 80)) ?? str(o.item, "", 80);
    if (!VALID_SHOPS.has(shop) || !validItemIds.has(item)) continue;
    const key = `${shop}:${item}`;
    if (seenShopKey.has(key)) continue;
    seenShopKey.add(key);
    shopListings.push({ shop, item, stock: num(o.stock, 2, 1, 20) });
  }

  const ripperdocListings: { ripperdoc: string; cyberware: string; stock: number }[] = [];
  const seenClinicKey = new Set<string>();
  for (const entry of asArr(raw.ripperdocListings)) {
    const o = asObj(entry);
    if (!o) continue;
    const ripperdoc = str(o.ripperdoc, "", 80);
    const cw = idMap.get(str(o.cyberware, "", 80)) ?? str(o.cyberware, "", 80);
    if (!VALID_RIPPERDOCS.has(ripperdoc) || !validCwIds.has(cw)) continue;
    const key = `${ripperdoc}:${cw}`;
    if (seenClinicKey.has(key)) continue;
    seenClinicKey.add(key);
    ripperdocListings.push({ ripperdoc, cyberware: cw, stock: num(o.stock, 1, 1, 20) });
  }

  const candidate = {
    format: "cp2077-workshop-pack" as const,
    version: 2 as const,
    id: packId,
    title: str(raw.title, "AI 创作内容包", 40),
    author: str(raw.author, fallbackAuthor, 40),
    description: str(raw.description, "", 300),
    characters: [],
    modules,
    acquaintances: [],
    npcs,
    seedNpcs,
    items,
    cyberware,
    braindances: [],
    chipContents: [],
    shopListings,
    ripperdocListings,
  };

  const parsed = WorkshopPackSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const total =
    parsed.data.modules.length +
    parsed.data.npcs.length +
    parsed.data.items.length +
    parsed.data.cyberware.length;
  return total > 0 ? parsed.data : null;
}

/** 调用辅助模型按自然语言需求一次性生成合规的创意工坊 v2 内容包 */
export async function generateWorkshopPack(
  llm: LlmClient,
  request: WorkshopGenerateRequest,
  signal?: AbortSignalLike,
): Promise<WorkshopGenerateResult> {
  const messages = buildPrompt(request);
  let text = "";
  for await (const event of llm.stream(
    {
      purpose: "aux",
      messages,
      maxOutputTokens: 3200,
      temperature: 0.7,
      responseFormat: { type: "json", name: "workshop_pack" },
    },
    signal,
  )) {
    if (event.type === "blocked") {
      return { ok: false, blocked: true, error: `模型拒绝或拦截了生成请求：${event.reason}` };
    }
    if (event.type === "text") {
      text += event.text;
    }
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "模型返回了空内容，请检查辅助模型配置或换个说法重试" };
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, error: "模型未返回有效 JSON 内容包，请稍后重试" };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { ok: false, error: "模型输出的 JSON 格式不完整，请再试一次" };
  }

  const obj = asObj(parsedRaw);
  if (!obj) {
    return { ok: false, error: "模型返回的顶层结构不是内容包对象" };
  }

  const normalized = normalizeGeneratedWorkshopPack(obj, request.author);
  if (!normalized) {
    return { ok: false, error: "生成的内容包未包含有效条目，请补充更具体的需求再试" };
  }

  return { ok: true, pack: normalized };
}
