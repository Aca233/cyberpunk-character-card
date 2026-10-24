import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boardModules,
  canonTimeline,
  combos,
  consequences,
  cyberware,
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  fixers,
  gameContent,
  glossary,
  items,
  jobTemplates,
  lifepath,
  loadouts,
  locations,
  npcs,
  openings,
  quickhacks,
  ripperdocs,
  sampleCharacters,
  shops,
  twists,
} from "@cp/content";
import {
  BASE_RULES,
  BoardModuleSchema,
  CanonTimelineSchema,
  CharacterCardSchema,
  ComboSchema,
  characterRules,
  contentPriceIssues,
  cyberwareRules,
  diceRules,
  EXTRACT_STAGE,
  falloutRules,
  GlossarySchema,
  hackingRules,
  healthRules,
  humanityRules,
  inventoryRules,
  JUDGE_STAGE,
  jobsRules,
  LifepathEntrySchema,
  NARRATE_STAGE,
  npcRules,
  registry,
  schemaDoc,
  TwistCatalogSchema,
  worldRules,
} from "@cp/core";
import type { z } from "zod";
import { ROOT } from "./assets/manifest";

/**
 * pnpm check-data：用 schema 检查 packages/content 的所有数据，再查跨表引用和重复 id。
 * 有本机的官方译名表（pnpm terms 生成的 data/lore/terms.json）时顺带核对名字，只提醒不算失败
 */

const errors: string[] = [];
const notes: string[] = [];

function schema(label: string, s: z.ZodType, data: unknown): void {
  const r = s.safeParse(data);
  if (!r.success) {
    for (const issue of r.error.issues.slice(0, 5)) {
      errors.push(`${label}：${issue.path.join(".") || "（整体）"} ${issue.message}`);
    }
  }
}

function unique(label: string, ids: readonly string[]): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${label}：id 重复「${id}」`);
    seen.add(id);
  }
  return seen;
}

function refs(
  label: string,
  wanted: readonly string[],
  have: ReadonlySet<string>,
  what: string,
): void {
  for (const id of wanted)
    if (!have.has(id)) errors.push(`${label}：引用了不存在的${what}「${id}」`);
}

// 1. 按 schema 校验
schema("物品表 items", inventoryRules.ItemCatalogSchema, items);
schema("义体表 cyberware", cyberwareRules.CyberwareCatalogSchema, cyberware);
schema("快速破解 quickhacks", hackingRules.QuickhackCatalogSchema, quickhacks);
schema("义体医生 ripperdocs", cyberwareRules.RipperdocListSchema, ripperdocs);
schema("商店 shops", inventoryRules.ShopListSchema, shops);
schema("地点 locations", worldRules.LocationCatalogSchema, locations);
schema("人物卡 npcs", npcRules.NpcCardSchema.passthrough().array(), npcs);
schema("中间人 fixers", jobsRules.FixerSchema.array(), fixers);
schema("转折素材 twists", TwistCatalogSchema, twists);
schema("后果参考表 consequences", falloutRules.ConsequenceTableSchema, consequences);
schema("委托模板 jobTemplates", jobsRules.JobTemplateCatalogSchema, jobTemplates);
schema("主板模块 boardModules", BoardModuleSchema.array(), boardModules);
schema("联动 combos", ComboSchema.array(), combos);
schema("生命路径 lifepath", LifepathEntrySchema.array(), lifepath);
schema("示例角色 characters", CharacterCardSchema.array(), sampleCharacters);
schema("黑话 glossary", GlossarySchema, glossary);
schema("原剧时间线 canonTimeline", CanonTimelineSchema, canonTimeline);

// 2. 重复 id
const itemIds = unique(
  "物品表",
  items.map((i) => i.id),
);
const chromeIds = unique(
  "义体表",
  cyberware.map((c) => c.id),
);
const quickhackIds = unique(
  "快速破解",
  quickhacks.map((q) => q.id),
);
for (const c of cyberware) {
  if (c.programSlots !== undefined && c.slot !== "os")
    errors.push(`义体 ${c.id}：只有操作系统义体能当网络接入仓（programSlots）`);
  if (c.programSlots !== undefined && c.ram === undefined)
    errors.push(`义体 ${c.id}：网络接入仓要写 RAM 格数`);
}
const locationIds = unique(
  "地点",
  locations.map((l) => l.id),
);
const fixerIds = unique(
  "中间人",
  fixers.map((f) => f.id),
);
const twistIds = unique(
  "转折素材",
  twists.map((t) => t.id),
);
const moduleIds = unique(
  "主板模块",
  boardModules.map((m) => m.id),
);
const loadoutIds = unique(
  "行装",
  loadouts.map((l) => l.id),
);
const openingIds = unique(
  "开场",
  openings.map((o) => o.id),
);
unique(
  "义体医生",
  ripperdocs.map((d) => d.id),
);
unique(
  "商店",
  shops.map((s) => s.id),
);
unique(
  "人物卡",
  (npcs as readonly { id: string }[]).map((n) => n.id),
);
unique(
  "委托模板",
  jobTemplates.map((t) => t.kind),
);
unique(
  "联动",
  combos.map((c) => c.id),
);

// 3. 跨表引用
for (const s of shops) {
  refs(`商店 ${s.id}`, [s.location], locationIds, "地点");
  refs(`商店 ${s.id}`, s.shelf, itemIds, "物品");
}
for (const d of ripperdocs) {
  refs(`义体医生 ${d.id}`, [d.location], locationIds, "地点");
  refs(`义体医生 ${d.id}`, d.shelf, chromeIds, "义体");
}
for (const l of loadouts) {
  refs(
    `行装 ${l.id}`,
    l.gear.map((g) => g.id),
    itemIds,
    "物品",
  );
  refs(`行装 ${l.id}`, l.cyberware ?? [], chromeIds, "义体");
  refs(`行装 ${l.id}`, l.programs ?? [], quickhackIds, "快速破解");
  if ((l.programs ?? []).length > 0) {
    const deck = cyberware.find((c) => (l.cyberware ?? []).includes(c.id) && c.programSlots);
    if (!deck) errors.push(`行装 ${l.id}：带了快速破解却没带网络接入仓`);
    else if ((l.programs ?? []).length > (deck.programSlots ?? 0))
      errors.push(`行装 ${l.id}：快速破解比 ${deck.name} 的程序格多`);
  }
  if (l.keywords.length === 0) errors.push(`行装 ${l.id}：没有关键词，永远选不中`);
}
for (const o of openings) {
  refs(`开场 ${o.id}`, [o.location], locationIds, "地点");
  refs(
    `开场 ${o.id}`,
    o.gear.map((g) => g.id),
    itemIds,
    "物品",
  );
  refs(`开场 ${o.id}`, o.cyberware ?? [], chromeIds, "义体");
  for (const j of o.jobs ?? []) {
    if (j.fixer) refs(`开场 ${o.id} 的委托 ${j.id}`, [j.fixer], fixerIds, "中间人");
    if (j.location) refs(`开场 ${o.id} 的委托 ${j.id}`, [j.location], locationIds, "地点");
    if (j.risk < 1 || j.risk > 5)
      errors.push(`开场 ${o.id} 的委托 ${j.id}：风险星级 ${j.risk} 不在 1–5`);
  }
}
const castIds = new Set<string>([
  ...(npcs as readonly { id: string }[]).map((n) => n.id),
  ...fixers.map((f) => f.id),
]);
for (const o of openings) {
  if (o.cast) refs(`开场 ${o.id} 的 cast`, o.cast, castIds, "人物卡或中间人");
  for (const j of o.jobs ?? []) {
    if (o.cast && j.fixer && !o.cast.includes(j.fixer))
      errors.push(`开场 ${o.id} 的委托 ${j.id}：中间人 ${j.fixer} 不在这个开场的 cast 里`);
  }
}
refs("defaultCast", gameContent.defaultCast ?? [], castIds, "人物卡或中间人");
for (const t of jobTemplates) refs(`委托模板 ${t.kind}`, t.twists, twistIds, "转折");
refs(
  "生命路径",
  lifepath.map((e) => e.id),
  moduleIds,
  "主板模块",
);
// 联动的每一项对上一块模块的 id、名字或标签就算数
const moduleKeys = new Set(boardModules.flatMap((m) => [m.id, m.label, ...(m.tags ?? [])]));
for (const c of combos) refs(`联动 ${c.id}`, c.requires, moduleKeys, "模块 id、名字或标签");
refs("默认行装 DEFAULT_LOADOUT", [DEFAULT_LOADOUT], loadoutIds, "行装");
refs("默认开场 DEFAULT_OPENING", [DEFAULT_OPENING], openingIds, "开场");

// 4. 数值范围：照策划书的价格参考表（暂定，调平衡时两边一起改）
for (const item of items) errors.push(...contentPriceIssues("item", item));
for (const chrome of cyberware) errors.push(...contentPriceIssues("cyberware", chrome));

// 5. 官方译名（本机有译名表时）
const TERMS = join(ROOT, "data", "lore", "terms.json");
if (existsSync(TERMS)) {
  const t = JSON.parse(readFileSync(TERMS, "utf8")) as {
    seeds?: Record<string, { zh: string }[]>;
    catalogs?: Record<string, { zh: string }[]>;
  };
  const official = new Set(
    [...Object.values(t.seeds ?? {}), ...Object.values(t.catalogs ?? {})].flat().map((x) => x.zh),
  );
  const names: [string, string][] = [
    ...cyberware.map((c): [string, string] => ["义体", c.name]),
    ...items.map((i): [string, string] => ["物品", i.name]),
    ...quickhacks.map((q): [string, string] => ["快速破解", q.name]),
  ];
  const off = names.filter(([, n]) => !official.has(n));
  notes.push(
    off.length === 0
      ? "义体和物品的名字都在官方译名表里"
      : `有 ${off.length} 个义体或物品的名字不在官方译名表里（自创的可以不改，详细对照跑 pnpm terms）`,
  );
} else {
  notes.push("本机没有官方译名表 data/lore/terms.json，跳过译名核对（需要时先跑 pnpm terms）");
}

// 档位换算：发给模型的说明里只出现档位，不出现换算表的数；修正值只能是一档或上限
{
  const { BONUS_CAP, DV_MOD_CAP, MOD_STEP, PENALTY_CAP } = diceRules;
  const { AFFINITY_SIZES } = npcRules;
  const { HUMANITY_KINDS } = humanityRules;
  const { DAMAGE_PERCENT } = healthRules;
  const { CRED_SIZES } = characterRules;
  const texts: [string, string][] = [
    ["常驻守则", BASE_RULES],
    ["判断", JUDGE_STAGE],
    ["抽取", EXTRACT_STAGE],
    ["写正文", NARRATE_STAGE],
    ...registry.rules.flatMap((m): [string, string][] =>
      [m.text, m.judge, m.narrate]
        .filter((t): t is string => t !== undefined)
        .map((t) => [`规则模块 ${m.id}`, t]),
    ),
    ...registry.commandTypes().flatMap((type): [string, string][] => {
      const s = registry.commandSchema(type);
      return s ? [[`指令 ${type} 的格式说明`, schemaDoc(s)]] : [];
    }),
  ];
  const allowed = new Set([1, MOD_STEP, BONUS_CAP, PENALTY_CAP, DV_MOD_CAP]);
  for (const [where, text] of texts) {
    for (const m of text.matchAll(/(?<![\w\d])[+−](\d+)/g)) {
      if (!allowed.has(Number(m[1]))) {
        errors.push(
          `${where}：出现了「${m[0]}」，修正只能是一档 ${MOD_STEP} 或上限，换算的数由代码查表`,
        );
      }
    }
    for (const m of text.matchAll(/\d+\s?%/g)) {
      errors.push(`${where}：出现了「${m[0]}」，伤害按档位写，百分比由代码换算`);
    }
  }
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`.replace("-", "−"));
  const humanity = Object.values(HUMANITY_KINDS)
    .map((k) => `${k.label} ${[...new Set(Object.values(k.sizes))].map(signed).join("/")}`)
    .join("，");
  notes.push(
    `换算表（和计划里的"档位换算"对照）：伤害 ${Object.values(DAMAGE_PERCENT).join("/")}%；好感 ±${Object.values(AFFINITY_SIZES).join("/")}；人性 ${humanity}；声望 ${Object.values(CRED_SIZES).join("/")} 级；修正一档 ${MOD_STEP}，上限 +${BONUS_CAP}/−${PENALTY_CAP}/+${DV_MOD_CAP}`,
  );
}

const counts = `物品 ${items.length}、义体 ${cyberware.length}、快速破解 ${quickhacks.length}、地点 ${locations.length}、人物 ${npcs.length}、主板模块 ${boardModules.length}、商店 ${shops.length}、义体医生 ${ripperdocs.length}、委托模板 ${jobTemplates.length}`;
for (const n of notes) console.log(n);
if (errors.length > 0) {
  console.log(`数据检查没通过，${errors.length} 处问题（${counts}）：`);
  for (const e of errors) console.log(`  ${e}`);
  process.exitCode = 1;
} else {
  console.log(`数据检查通过：${counts}`);
}
