import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agendas,
  apartments,
  arcs,
  boardModules,
  braindances,
  canonTimeline,
  consequences,
  cyberware,
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  DISTRICT_CENTERS,
  encounters,
  factions,
  fixers,
  gameContent,
  gameData,
  glossary,
  homes,
  items,
  jobTemplates,
  loadouts,
  locations,
  ncpdAlerts,
  npcs,
  openings,
  quickhacks,
  ripperdocs,
  sampleCharacters,
  shops,
  sidegigs,
  twists,
  vehicles,
} from "@cp/content";
import {
  arcRules,
  BASE_RULES,
  BoardModuleSchema,
  braindanceRules,
  CanonTimelineSchema,
  CharacterCardSchema,
  contentPriceIssues,
  cyberwareRules,
  EXTRACT_STAGE,
  factionsRules,
  falloutRules,
  GlossarySchema,
  hackingRules,
  inventoryRules,
  JUDGE_STAGE,
  jobsRules,
  NARRATE_STAGE,
  ncpdRules,
  newGameWorld,
  npcRules,
  projectState,
  registry,
  safehouseRules,
  schemaDoc,
  sidegigRules,
  TwistCatalogSchema,
  travelRules,
  withAllSlices,
  worldRules,
} from "@cp/core";
import type { z } from "zod";
import { ROOT } from "./assets/manifest";
import { merchantDataIssues } from "./merchant-data";

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
schema("路上偶遇 encounters", travelRules.EncounterCatalogSchema, encounters);
schema("势力 factions", factionsRules.FactionCatalogSchema, factions);
schema("势力动向 agendas", factionsRules.AgendaCatalogSchema, agendas);
schema("NCPD 警情 ncpdAlerts", ncpdRules.AlertCatalogSchema, ncpdAlerts);
schema("开局住所 homes", safehouseRules.HomeCatalogSchema, homes);
schema("公寓 apartments", safehouseRules.ApartmentCatalogSchema, apartments);
schema("拳赛和赛车 sidegigs", sidegigRules.GigCatalogSchema, sidegigs);
schema("车型 vehicles", travelRules.VehicleCatalogSchema, vehicles);
schema("人物卡 npcs", npcRules.NpcCardSchema.passthrough().array(), npcs);
schema("中间人 fixers", jobsRules.FixerSchema.array(), fixers);
schema("转折素材 twists", TwistCatalogSchema, twists);
schema("后果参考表 consequences", falloutRules.ConsequenceTableSchema, consequences);
schema("委托模板 jobTemplates", jobsRules.JobTemplateCatalogSchema, jobTemplates);
schema("主板模块 boardModules", BoardModuleSchema.array(), boardModules);
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
unique(
  "快速破解",
  quickhacks.map((q) => q.id),
);
for (const c of cyberware) {
  if (c.deckTraits !== undefined && c.slot !== "os" && c.slot !== "frontalCortex")
    errors.push(`义体 ${c.id}：只有操作系统或额叶皮质义体能带黑客硬件特化（deckTraits）`);
  if (c.deckTraits !== undefined && c.deckProfile === undefined)
    errors.push(`义体 ${c.id}：带 deckTraits 的黑客义体要写定性定位 deckProfile`);
}
const locationIds = unique(
  "地点",
  locations.map((l) => l.id),
);
const vehicleIds = unique(
  "车型",
  vehicles.map((v) => v.id),
);
const fixerIds = unique(
  "中间人",
  fixers.map((f) => f.id),
);
const twistIds = unique(
  "转折素材",
  twists.map((t) => t.id),
);
unique(
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
// 人物卡的身体：原作人物都要写；装备和义体只能用物品表、义体表里有的
for (const n of npcs) {
  if (!n.body) {
    if (n.canon) errors.push(`人物 ${n.id}：原作人物要写 body（档位、属性、装备、义体）`);
    continue;
  }
  refs(`人物 ${n.id} 的装备`, n.body.gear, itemIds, "物品");
  refs(`人物 ${n.id} 的义体`, n.body.cyberware, chromeIds, "义体");
}
unique(
  "委托模板",
  jobTemplates.map((t) => t.kind),
);

// 3. 跨表引用
errors.push(...merchantDataIssues(gameData));
for (const l of loadouts) {
  refs(
    `行装 ${l.id}`,
    l.gear.map((g) => g.id),
    itemIds,
    "物品",
  );
  refs(`行装 ${l.id}`, l.cyberware ?? [], chromeIds, "义体");
  refs(`行装 ${l.id}`, l.vehicles ?? [], vehicleIds, "车型");
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

// 因果规则：提示词不教模型按生命百分比、人性扣点或属性加减决定结果
{
  const texts: [string, string][] = [
    ["常驻守则", BASE_RULES],
    ["判断", JUDGE_STAGE],
    ["抽取", EXTRACT_STAGE],
    ["写正文", NARRATE_STAGE],
    ...consequences.map((entry): [string, string] => [
      `后果素材 ${entry.label}`,
      entry.examples.join("\n"),
    ]),
    ...twists.map((entry): [string, string] => [`局面素材 ${entry.id}`, entry.text]),
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
  for (const [where, text] of texts) {
    for (const m of text.matchAll(/(?<![\w\d])[+−](\d+)/g)) {
      errors.push(`${where}：出现了「${m[0]}」，模型说明里不应以属性或点数加减代替实际条件`);
    }
    for (const m of text.matchAll(/\d+\s?%/g)) {
      errors.push(`${where}：出现了「${m[0]}」，伤害应记录具体损伤，不按固定生命百分比结算`);
    }
  }
  notes.push("提示词与后果/局面素材检查：不包含固定伤害百分比或属性加减公式；不依赖废弃换算表");
}

// 地图和偶遇：地点都要有坐标，偶遇只能写地点表里有的城区
unique(
  "路上偶遇",
  encounters.map((e) => e.id),
);
const districts = new Set(Object.keys(DISTRICT_CENTERS));
for (const l of locations) {
  if (l.x === undefined || l.y === undefined) errors.push(`地点 ${l.id}：没有地图坐标（map.ts）`);
  if (!districts.has(l.district))
    errors.push(`地点 ${l.id}：城区「${l.district}」不在 map.ts 的城区表里`);
}
for (const e of encounters) {
  for (const d of e.districts ?? []) {
    if (!districts.has(d)) errors.push(`偶遇 ${e.id}：城区「${d}」不在 map.ts 的城区表里`);
  }
}
// 偶遇按城区扩充（M3）：每个城区至少这么多条专属的（districts 里写了它的），全城通用的不算
const LOCAL_ENCOUNTERS_MIN = 10;
for (const d of districts) {
  const local = encounters.filter((e) => e.districts?.includes(d)).length;
  if (local < LOCAL_ENCOUNTERS_MIN)
    errors.push(`偶遇：城区「${d}」专属的只有 ${local} 条，至少要 ${LOCAL_ENCOUNTERS_MIN} 条`);
}

// 势力卡：地盘只写城区表里的城区，盟友和仇敌要在势力表里
const factionIds = unique(
  "势力",
  factions.map((f) => f.id),
);
for (const f of factions) {
  for (const d of f.turf)
    if (!districts.has(d)) errors.push(`势力 ${f.id}：地盘「${d}」不在 map.ts 的城区表里`);
  refs(`势力 ${f.id} 的盟友`, f.allies, factionIds, "势力");
  refs(`势力 ${f.id} 的仇敌`, f.enemies, factionIds, "势力");
  if (f.allies.includes(f.id) || f.enemies.includes(f.id))
    errors.push(`势力 ${f.id}：关系里写了自己`);
}

// 人物卡的常在地点和所属势力：要在地点表、势力表里（none 是不属于任何势力）；
// 中间人的好感记在同 id 的人物卡上，每个中间人都要有人物卡（用户 2026-11-02 补卡时加的检查）
const npcIds = new Set(npcs.map((n) => n.id));
for (const n of npcs) {
  if (n.home) refs(`人物 ${n.id} 的常在地点`, [n.home], locationIds, "地点");
  if (n.faction && n.faction !== "none")
    refs(`人物 ${n.id} 的势力`, [n.faction], factionIds, "势力");
}
refs(
  "中间人",
  fixers.map((f) => f.id),
  npcIds,
  "人物卡",
);

// 势力动向的种子：势力和对头要在势力表里，能争的城区要在城区表里，每条要有原作参考
unique(
  "势力动向",
  agendas.map((a) => a.id),
);
for (const a of agendas) {
  refs(`势力动向 ${a.id} 的势力`, [a.faction], factionIds, "势力");
  refs(`势力动向 ${a.id} 的对头`, a.rivals, factionIds, "势力");
  if (a.rivals.includes(a.faction)) errors.push(`势力动向 ${a.id}：对头里写了自己`);
  for (const d of a.districts)
    if (!districts.has(d)) errors.push(`势力动向 ${a.id}：城区「${d}」不在 map.ts 的城区表里`);
  if (a.canon.length === 0) errors.push(`势力动向 ${a.id}：没写参考的原作任务`);
}

// 心事的种子：人物要是原作人物卡，要写参考的原作任务；每件心事的原作结局要写原作里怎样或标本作改编
schema("心事 arcs", arcRules.ArcCatalogSchema, arcs);
const canonNpcIds = new Set(npcs.filter((n) => n.canon).map((n) => n.id));
for (const a of arcs) {
  refs(`心事 ${a.npc}`, [a.npc], canonNpcIds, "原作人物");
  if (a.refs.length === 0) errors.push(`心事 ${a.npc}：没写参考的原作任务`);
  for (const c of a.concerns) {
    if (!/原作里|本作改编/.test(c.canon))
      errors.push(`心事 ${c.id}：原作结局要写「原作里……」或标本作改编`);
  }
}

// 固定作品目录；片段时长与材料引用在 schema 中校验，不再要求小游戏答案。
schema("超梦作品 braindances", braindanceRules.BdWorkListSchema, braindances);

// NCPD 警情：只能写 NCPD 管得到的城区
unique(
  "NCPD 警情",
  ncpdAlerts.map((a) => a.id),
);
for (const a of ncpdAlerts) {
  for (const d of a.districts ?? []) {
    if (!districts.has(d)) errors.push(`NCPD 警情 ${a.id}：城区「${d}」不在 map.ts 的城区表里`);
    if (ncpdRules.ALERT_EXCLUDED_DISTRICTS.includes(d))
      errors.push(`NCPD 警情 ${a.id}：${d}NCPD 管不到`);
  }
}

// 开局住所：地点要在地点表里，每个出身最多一处，要有 default
unique(
  "开局住所",
  homes.map((h) => h.id),
);
unique(
  "开局住所的出身",
  homes.map((h) => h.origin),
);
if (!homes.some((h) => h.origin === "default"))
  errors.push("开局住所：没有 origin 为 default 的一处");
for (const h of homes) {
  if (!locations.some((l) => l.id === h.location))
    errors.push(`开局住所 ${h.id}：地点 ${h.location} 不在地点表里`);
}

// 能买的公寓：id 不和开局住所撞，地点要在地点表里，来源要标原作依据、本作改编或待核对
unique("开局住所和公寓", [...homes.map((h) => h.id), ...apartments.map((a) => a.id)]);
for (const a of apartments) {
  refs(`公寓 ${a.id}`, [a.location], locationIds, "地点");
  if (!/原作依据|本作改编|待核对/.test(a.source))
    errors.push(`公寓 ${a.id}：来源要标原作依据、本作改编或待核对`);
}

// 拳赛和赛车：地点要在地点表里，对手不重复，赢了拿的要比押金多，来源要标原作依据、本作改编或待核对
unique(
  "拳赛和赛车",
  sidegigs.map((g) => g.id),
);
unique(
  "拳赛和赛车的对手",
  sidegigs.map((g) => g.opponent),
);
for (const g of sidegigs) {
  refs(`拳赛和赛车 ${g.id}`, [g.location], locationIds, "地点");
  if (g.purse <= g.stake) errors.push(`拳赛和赛车 ${g.id}：奖金 ${g.purse} 不比押金 ${g.stake} 多`);
  if (!/原作依据|本作改编|待核对/.test(g.source))
    errors.push(`拳赛和赛车 ${g.id}：来源要标原作依据、本作改编或待核对`);
}
for (const kind of ["fight", "race"] as const) {
  const n = sidegigs.filter((g) => g.kind === kind).length;
  if (n < 3) notes.push(`${sidegigRules.GIG_KIND_LABELS[kind]}只有 ${n} 场，M2b 计划每种 3 场`);
}

// 隐藏信息不能进玩家投影：每个开场建一个示例世界跑 projectState，
// 键名里不能有 truth、answer、twist、secret 这类；开场委托塞一段带标记的 twist，投影里不能出现它的原文
const HIDDEN_KEY = /truth|answer|twist|secret|hidden|spoiler|solution/i;
const TWIST_MARK = "【隐藏转折探针：这段只给叙事模型看】";
let planted = 0;
for (const o of openings) {
  const baseJobs =
    o.jobs && o.jobs.length > 0
      ? o.jobs
      : [
          {
            id: "probe-twist",
            title: "匿名委托探针",
            client: "匿名客户",
            risk: 1,
            reward: 1000,
            conflict: "测试隐秘冲突",
            afterMinutes: 60,
          },
        ];
  const probe = {
    ...o,
    jobs: baseJobs.map((j) => ({ ...j, twist: `${TWIST_MARK}${j.id}` })),
  };
  planted += probe.jobs.length;
  const world = withAllSlices(
    newGameWorld(
      {
        startTime: Date.UTC(2077, 9, 1, 22) / 60000,
        opening: probe.id,
        loadouts: [DEFAULT_LOADOUT],
      },
      { ...gameContent, openings: [probe] },
    ),
  );
  const view = projectState(world, [], gameData);
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (HIDDEN_KEY.test(k))
        errors.push(`玩家投影（开场 ${o.id}）：${path}.${k} 像是隐藏信息的字段名`);
      walk(x, `${path}.${k}`);
    }
  };
  walk(view, "state");
  if (JSON.stringify(view).includes(TWIST_MARK))
    errors.push(`玩家投影（开场 ${o.id}）：委托的隐藏转折原文进了投影`);
}
if (planted === 0) errors.push("玩家投影：没有一个开场带委托，隐藏转折的检查没覆盖到");

const counts = `物品 ${items.length}、义体 ${cyberware.length}、快速破解 ${quickhacks.length}、地点 ${locations.length}、人物 ${npcs.length}、主板模块 ${boardModules.length}、商店 ${shops.length}、义体医生 ${ripperdocs.length}、委托模板 ${jobTemplates.length}、偶遇 ${encounters.length}、车型 ${vehicles.length}、势力 ${factions.length}、势力动向 ${agendas.length}、心事 ${arcs.length}、超梦录像 ${braindances.length}、NCPD 警情 ${ncpdAlerts.length}、开局住所 ${homes.length}、公寓 ${apartments.length}、拳赛和赛车 ${sidegigs.length}`;
for (const n of notes) console.log(n);
if (errors.length > 0) {
  console.log(`数据检查没通过，${errors.length} 处问题（${counts}）：`);
  for (const e of errors) console.log(`  ${e}`);
  process.exitCode = 1;
} else {
  console.log(`数据检查通过：${counts}`);
}
