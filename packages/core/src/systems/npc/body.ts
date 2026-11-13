import type { ApplyOutcome } from "../../kernel/system";
import { type CyberwareSlot, cyberwareCatalog, SLOT_CAPACITY, SLOT_LABELS } from "../cyberware";
import { type Attribute, type DamageTier, maxHp } from "../dice";
import { DAMAGE_PERCENT } from "../health";
import { HUMANITY_KINDS, humanityStage, STAGE_LABELS } from "../humanity";
import { itemCatalog } from "../inventory";
import {
  NPC_ATTR_MAX,
  NPC_CHROME_MAX,
  NPC_GEAR_MAX,
  NPC_TIER_CRED,
  NPC_TIER_DEFAULT_ATTR,
  type Npc,
  type NpcAttributes,
  type NpcBodyCard,
  type NpcChrome,
  type NpcGear,
  type NpcHeal,
  type NpcHumanity,
  type NpcHurt,
  type NpcScan,
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
  problems.push(...slotProblems(body.cyberware, chrome));
  return problems;
}

/**
 * 按部位数格子（用户 2026-11-02 选的"按部位给 NPC 定规矩"）：和玩家同一套 SLOT_CAPACITY，
 * 操作系统只有 1 格，所以网络接入仓、斯安威斯坦、狂暴只能装一个；表里没有的 id 不算
 */
export function slotProblems(
  ids: readonly string[],
  chrome: ReadonlyMap<string, { readonly slot: CyberwareSlot; readonly name: string }>,
): string[] {
  const bySlot = new Map<CyberwareSlot, string[]>();
  for (const id of ids) {
    const def = chrome.get(id);
    if (!def) continue;
    bySlot.set(def.slot, [...(bySlot.get(def.slot) ?? []), def.name]);
  }
  const problems: string[] = [];
  for (const [slot, list] of bySlot) {
    const cap = SLOT_CAPACITY[slot];
    if (list.length > cap) {
      problems.push(
        `${SLOT_LABELS[slot]}最多装 ${cap} 件，现在装了 ${list.length} 件（${list.join("、")}）`,
      );
    }
  }
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
  return a.body + a.reflexes + a.tech + a.intelligence + a.cool;
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
      const catalog = cyberwareCatalog(data);
      const def = catalog.get(command.cyberware);
      if (!def) return { ok: false, reason: `义体表里没有「${command.cyberware}」` };
      const { body } = settle(npc, data, now);
      const has = body.cyberware.includes(command.cyberware);
      let swapped: string | undefined;
      if (command.action === "install") {
        if (has) return { ok: true };
        // 部位装满了换下这个部位最早装的那件，和玩家的 cyberware 指令一样；操作系统只有 1 格
        const sameSlot = body.cyberware.filter((c) => catalog.get(c)?.slot === def.slot);
        const out = sameSlot.length >= SLOT_CAPACITY[def.slot] ? sameSlot[0] : undefined;
        const kept = out === undefined ? body.cyberware : body.cyberware.filter((c) => c !== out);
        if (kept.length >= NPC_CHROME_MAX) {
          return {
            ok: false,
            reason: `${npc.name} 已经装了 ${NPC_CHROME_MAX} 件义体，先 remove 一件`,
          };
        }
        npc.body = { ...body, cyberware: [...kept, command.cyberware] };
        if (out !== undefined) swapped = catalog.get(out)?.name ?? out;
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
      const swapNote = swapped === undefined ? "" : `，换下了 ${swapped}`;
      return { ok: true, notes: npc.met ? [`${npc.name} ${verb} ${def.name}${swapNote}`] : [] };
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

function names(
  ids: readonly string[],
  lookup: ReadonlyMap<string, { readonly name: string }>,
): string[] {
  return ids.map((id) => lookup.get(id)?.name ?? id);
}

/** 一件义体的名字、部位和效果说明（义体表的 ability）；表里没有的 id 只有名字 */
export interface ChromeDetail {
  readonly name: string;
  readonly slot: string;
  readonly ability: string;
}

/**
 * 义体不再只是一串名字（用户 2026-11-02："npc的义体是不是太简单了，只有一个文字描述"）：
 * 叙事模型和扫描面板都拿到部位和效果说明
 */
export function chromeDetails(ids: readonly string[], data: Data): ChromeDetail[] {
  const catalog = cyberwareCatalog(data);
  return ids.map((id) => {
    const def = catalog.get(id);
    return def
      ? { name: def.name, slot: SLOT_LABELS[def.slot], ability: def.ability }
      : { name: id, slot: "", ability: "" };
  });
}

function chromeText(list: readonly ChromeDetail[]): string {
  if (list.length === 0) return "没有";
  return list
    .map((c) => (c.ability ? `${c.name}（${c.slot}：${c.ability.replace(/。$/, "")}）` : c.name))
    .join("、");
}

/** 完整卡上的一行身体：定性伤势、装备、义体（带部位和效果）、人性阶段；不输出 RPG 阶层或属性数字 */
export function bodyLine(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): string {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const gear = names(body.gear, itemCatalog(data));
  const chrome = chromeDetails(body.cyberware, data);
  return [
    `身体状态：${woundLabel(v.hp, v.max)}`,
    `装备：${gear.length ? gear.join("、") : "没有"}`,
    `义体：${chromeText(chrome)}`,
    `人性状态：${STAGE_LABELS[humanityStage(v.humanity)]}`,
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

/** 玩家视图里的身体：见过的人看伤势和装备；扫描过的看实际义体配置与精神/人性稳定度，不展示游戏数值 */
export interface NpcBodyView {
  readonly wound: string;
  readonly gear: readonly string[];
  readonly scan: {
    readonly chrome: readonly ChromeDetail[];
    readonly humanityStage: string;
    readonly at: number;
  } | null;
}

export function bodyView(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): NpcBodyView {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const view: NpcBodyView = {
    wound: woundLabel(v.hp, v.max),
    gear: names(body.gear, itemCatalog(data)),
    scan: null,
  };
  if (v.scannedAt === null) return view;
  return {
    ...view,
    scan: {
      chrome: chromeDetails(body.cyberware, data),
      humanityStage: STAGE_LABELS[humanityStage(v.humanity)],
      at: v.scannedAt,
    },
  };
}
