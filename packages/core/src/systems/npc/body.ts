import type { ApplyOutcome } from "../../kernel/system";
import { cyberwareCatalog } from "../cyberware";
import { ATTRIBUTE_LABELS, type Attribute, AttributeSchema, type DamageTier, maxHp } from "../dice";
import { DAMAGE_PERCENT } from "../health";
import { HUMANITY_KINDS, humanityStage, STAGE_LABELS } from "../humanity";
import { itemCatalog } from "../inventory";
import {
  NPC_ATTR_MAX,
  NPC_CHROME_MAX,
  NPC_GEAR_MAX,
  NPC_TIER_CRED,
  NPC_TIER_DEFAULT_ATTR,
  NPC_TIER_LABELS,
  type Npc,
  type NpcAttributes,
  type NpcBodyCard,
  type NpcChrome,
  type NpcGear,
  type NpcHeal,
  type NpcHumanity,
  type NpcHurt,
  type NpcScan,
  type NpcTier,
  type NpcVitals,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;

/** 没倒下的人每过这么多分钟回一次血（本作改编，暂定） */
export const NPC_REGEN_MINUTES = 360;
/** 每次回生命上限的百分之几 */
export const NPC_REGEN_PERCENT = 10;
/** 休整、用治疗品各回上限的百分之几；义体医生直接治满，也能把倒下的人救起来 */
export const NPC_HEAL_PERCENT = { rest: 30, maxdoc: 40 } as const;

export const NPC_DAMAGE_LABELS: Readonly<Record<DamageTier, string>> = {
  graze: "擦伤",
  heavy: "重伤",
  lethal: "致命伤",
};
const LOWER_TIER: Readonly<Record<DamageTier, DamageTier>> = {
  graze: "graze",
  heavy: "graze",
  lethal: "heavy",
};

export type FilledBody = NpcBodyCard & { readonly attributes: NpcAttributes };

/** 卡上的身体补齐默认值：没写身体按普通人，没写属性按档位的默认值 */
export function filledBody(body: NpcBodyCard | undefined): FilledBody {
  const b: NpcBodyCard = body ?? { tier: "mook", gear: [], cyberware: [] };
  const d = NPC_TIER_DEFAULT_ATTR[b.tier];
  return {
    ...b,
    gear: [...b.gear],
    cyberware: [...b.cyberware],
    attributes: b.attributes
      ? { ...b.attributes }
      : { body: d, reflexes: d, tech: d, intelligence: d, cool: d },
  };
}

/** 卡上写的物品和义体 id 是不是都在表里；返回问题列表 */
export function bodyProblems(body: NpcBodyCard | undefined, data: Data): string[] {
  if (!body) return [];
  const items = itemCatalog(data);
  const chrome = cyberwareCatalog(data);
  const problems: string[] = [];
  for (const id of body.gear) if (!items.has(id)) problems.push(`物品表里没有「${id}」`);
  for (const id of body.cyberware) if (!chrome.has(id)) problems.push(`义体表里没有「${id}」`);
  return problems;
}

/** 有效属性 = 卡上属性 + 义体加成，封顶 20 */
export function effectiveAttributes(body: FilledBody, data: Data): NpcAttributes {
  const chrome = cyberwareCatalog(data);
  const out = { ...body.attributes };
  for (const id of body.cyberware) {
    const def = chrome.get(id);
    if (!def) continue;
    for (const [attr, bonus] of Object.entries(def.attributes) as [Attribute, number][]) {
      out[attr] = Math.min(NPC_ATTR_MAX, out[attr] + bonus);
    }
  }
  return out;
}

export function attributeSum(a: NpcAttributes): number {
  return AttributeSchema.options.reduce((s, k) => s + a[k], 0);
}

export function npcMaxHp(body: FilledBody, data: Data): number {
  return maxHp(effectiveAttributes(body, data).body, NPC_TIER_CRED[body.tier]);
}

/** 人性上限 = 100 − 装着的义体的人性消耗，不低于 0 */
export function npcHumanityCap(body: FilledBody, data: Data): number {
  const chrome = cyberwareCatalog(data);
  const cost = body.cyberware.reduce((s, id) => s + (chrome.get(id)?.humanityCost ?? 0), 0);
  return Math.max(0, 100 - cost);
}

function hasArmor(body: FilledBody, data: Data): boolean {
  const chrome = cyberwareCatalog(data);
  return body.cyberware.some((id) => chrome.get(id)?.armor === true);
}

/**
 * 此刻的身体数值：没记过的按满血和开局人性算；hp 大于 0 时按时间惰性回血，到 0 不自己好。
 * 不改人物，只算
 */
export function currentVitals(
  npc: Pick<Npc, "body" | "vitals">,
  data: Data,
  now: number,
): NpcVitals & { readonly max: number } {
  const body = filledBody(npc.body);
  const max = npcMaxHp(body, data);
  const cap = npcHumanityCap(body, data);
  const v = npc.vitals;
  if (!v) {
    return {
      hp: max,
      hpAt: now,
      humanity: Math.min(cap, body.humanity ?? cap),
      hurtAt: null,
      scannedAt: null,
      max,
    };
  }
  let hp = Math.min(v.hp, max);
  let hpAt = v.hpAt;
  if (hp > 0 && hp < max && now > hpAt) {
    const ticks = Math.floor((now - hpAt) / NPC_REGEN_MINUTES);
    if (ticks > 0) {
      hp = Math.min(max, hp + ticks * Math.ceil((max * NPC_REGEN_PERCENT) / 100));
      hpAt += ticks * NPC_REGEN_MINUTES;
    }
  }
  if (hp >= max) hpAt = Math.max(hpAt, now);
  return { ...v, hp, hpAt, humanity: Math.min(v.humanity, cap), max };
}

/** 伤势：满血没事，一半以上轻伤，还有血重伤，0 倒下 */
export function woundLabel(hp: number, max: number): string {
  if (hp >= max) return "没受伤";
  if (hp * 2 >= max) return "轻伤";
  if (hp > 0) return "重伤";
  return "倒下";
}

export type Threat = "low" | "even" | "high" | "skull";
export const THREAT_LABELS: Readonly<Record<Threat, string>> = {
  low: "低",
  even: "相当",
  high: "高",
  skull: "骷髅",
};
/** 威胁：他的有效属性总和比玩家角色的高多少；远高于玩家时是骷髅（原作扫描的图标，阈值本作改编） */
export function threatOf(npcSum: number, playerSum: number): Threat {
  const diff = npcSum - playerSum;
  if (diff <= -8) return "low";
  if (diff < 8) return "even";
  if (diff <= 20) return "high";
  return "skull";
}

/** 写回人物：补齐身体，把此刻的数值记下来 */
function settle(
  npc: Npc,
  data: Data,
  now: number,
): { body: FilledBody; v: NpcVitals; max: number } {
  const body = filledBody(npc.body);
  const { max, ...v } = currentVitals(npc, data, now);
  npc.body = body;
  npc.vitals = v;
  return { body, v: npc.vitals, max };
}

export type NpcBodyCommand = NpcHurt | NpcHeal | NpcGear | NpcChrome | NpcHumanity | NpcScan;

export function applyNpcBody(
  npc: Npc,
  command: NpcBodyCommand,
  now: number,
  data: Data,
): ApplyOutcome {
  switch (command.type) {
    case "npcHurt": {
      const { body, v, max } = settle(npc, data, now);
      if (v.hp === 0) return { ok: false, reason: `${npc.name} 已经倒下了；死了写 npcDeath` };
      const armored = hasArmor(body, data);
      const tier = armored ? LOWER_TIER[command.tier] : command.tier;
      const damage = Math.ceil((max * DAMAGE_PERCENT[tier]) / 100);
      v.hp = Math.max(0, v.hp - damage);
      v.hpAt = now;
      v.hurtAt = now;
      const lowered = armored && tier !== command.tier ? "，护甲挡掉一档" : "";
      const down = v.hp === 0 ? "，倒下了" : "";
      return { ok: true, notes: [`${npc.name} ${NPC_DAMAGE_LABELS[tier]}${lowered}${down}`] };
    }
    case "npcHeal": {
      const { v, max } = settle(npc, data, now);
      if (v.hp === 0 && command.how !== "ripperdoc") {
        return { ok: false, reason: `${npc.name} 倒下了，只有义体医生（ripperdoc）能救起来` };
      }
      if (v.hp >= max) return { ok: true };
      v.hp =
        command.how === "ripperdoc"
          ? max
          : Math.min(max, v.hp + Math.ceil((max * NPC_HEAL_PERCENT[command.how]) / 100));
      v.hpAt = now;
      return { ok: true, notes: [`${npc.name} ${v.hp >= max ? "伤养好了" : "伤势好转"}`] };
    }
    case "npcGear": {
      const def = itemCatalog(data).get(command.item);
      if (!def) return { ok: false, reason: `物品表里没有「${command.item}」` };
      const { body } = settle(npc, data, now);
      const has = body.gear.includes(command.item);
      if (command.action === "add") {
        if (has) return { ok: true };
        if (body.gear.length >= NPC_GEAR_MAX) {
          return {
            ok: false,
            reason: `${npc.name} 的装备栏满了（最多 ${NPC_GEAR_MAX} 件），先 remove 一件`,
          };
        }
        npc.body = { ...body, gear: [...body.gear, command.item] };
        return { ok: true, notes: npc.met ? [`${npc.name} 拿上了 ${def.name}`] : [] };
      }
      if (!has) return { ok: false, reason: `${npc.name} 的装备栏里没有 ${def.name}` };
      npc.body = { ...body, gear: body.gear.filter((g) => g !== command.item) };
      return { ok: true, notes: npc.met ? [`${npc.name} 不再带着 ${def.name}`] : [] };
    }
    case "npcChrome": {
      const def = cyberwareCatalog(data).get(command.cyberware);
      if (!def) return { ok: false, reason: `义体表里没有「${command.cyberware}」` };
      const { body } = settle(npc, data, now);
      const has = body.cyberware.includes(command.cyberware);
      if (command.action === "install") {
        if (has) return { ok: true };
        if (body.cyberware.length >= NPC_CHROME_MAX) {
          return {
            ok: false,
            reason: `${npc.name} 已经装了 ${NPC_CHROME_MAX} 件义体，先 remove 一件`,
          };
        }
        npc.body = { ...body, cyberware: [...body.cyberware, command.cyberware] };
      } else {
        if (!has) return { ok: false, reason: `${npc.name} 没装 ${def.name}` };
        npc.body = { ...body, cyberware: body.cyberware.filter((c) => c !== command.cyberware) };
      }
      // 换了义体，上限可能变了：人性压到新上限以内，生命不超过新上限
      const after = filledBody(npc.body);
      const v = npc.vitals as NpcVitals;
      v.humanity = Math.min(v.humanity, npcHumanityCap(after, data));
      v.hp = Math.min(v.hp, npcMaxHp(after, data));
      const verb = command.action === "install" ? "装上了" : "拆掉了";
      return { ok: true, notes: npc.met ? [`${npc.name} ${verb} ${def.name}`] : [] };
    }
    case "npcHumanity": {
      const { body, v } = settle(npc, data, now);
      const delta: number = HUMANITY_KINDS[command.kind].sizes[command.size];
      v.humanity = Math.max(0, Math.min(npcHumanityCap(body, data), v.humanity + delta));
      // 数值和阶段都不出提示条：玩家只从正文里的征兆看出来
      return { ok: true };
    }
    case "npcScan": {
      const { v } = settle(npc, data, now);
      v.scannedAt = now;
      return { ok: true, notes: [`扫描了 ${npc.name}`] };
    }
  }
}

function attrText(a: NpcAttributes): string {
  return AttributeSchema.options.map((k) => `${ATTRIBUTE_LABELS[k]} ${a[k]}`).join("、");
}

function names(
  ids: readonly string[],
  lookup: ReadonlyMap<string, { readonly name: string }>,
): string[] {
  return ids.map((id) => lookup.get(id)?.name ?? id);
}

/** 完整卡上的一行身体：档位、有效属性、生命和伤势、装备、义体、人性数值和阶段；只给叙事模型 */
export function bodyLine(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): string {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const gear = names(body.gear, itemCatalog(data));
  const chrome = names(body.cyberware, cyberwareCatalog(data));
  return [
    `身体：${NPC_TIER_LABELS[body.tier]}；${attrText(effectiveAttributes(body, data))}`,
    `生命 ${v.hp}/${v.max}（${woundLabel(v.hp, v.max)}）`,
    `装备：${gear.length ? gear.join("、") : "没有"}`,
    `义体：${chrome.length ? chrome.join("、") : "没有"}`,
    `人性 ${v.humanity}（${STAGE_LABELS[humanityStage(v.humanity)]}）`,
  ].join("；");
}

/** 一行人物里带的伤势：没受伤不写 */
export function woundNote(
  npc: Pick<Npc, "body" | "vitals">,
  data: Data,
  now: number,
): string | undefined {
  if (!npc.vitals) return undefined;
  const v = currentVitals(npc, data, now);
  return v.hp >= v.max ? undefined : woundLabel(v.hp, v.max);
}

/** 玩家视图里的身体：见过的人看伤势和装备；扫描过的再看档位、威胁、属性、生命、义体和人性阶段。人性数值永远不给 */
export interface NpcBodyView {
  readonly wound: string;
  readonly gear: readonly string[];
  readonly scan: {
    readonly tier: string;
    readonly threat: Threat;
    readonly threatLabel: string;
    readonly attributes: readonly { readonly label: string; readonly value: number }[];
    readonly hp: number;
    readonly max: number;
    readonly chrome: readonly string[];
    readonly humanityStage: string;
    readonly at: number;
  } | null;
}

export function bodyView(
  npc: Pick<Npc, "body" | "vitals">,
  data: Data,
  now: number,
  playerAttributeSum: number,
): NpcBodyView {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const view: NpcBodyView = {
    wound: woundLabel(v.hp, v.max),
    gear: names(body.gear, itemCatalog(data)),
    scan: null,
  };
  if (v.scannedAt === null) return view;
  const eff = effectiveAttributes(body, data);
  const threat = threatOf(attributeSum(eff), playerAttributeSum);
  return {
    ...view,
    scan: {
      tier: NPC_TIER_LABELS[body.tier as NpcTier],
      threat,
      threatLabel: THREAT_LABELS[threat],
      attributes: AttributeSchema.options.map((k) => ({
        label: ATTRIBUTE_LABELS[k],
        value: eff[k],
      })),
      hp: v.hp,
      max: v.max,
      chrome: names(body.cyberware, cyberwareCatalog(data)),
      humanityStage: STAGE_LABELS[humanityStage(v.humanity)],
      at: v.scannedAt,
    },
  };
}
