import type { ApplyOutcome } from "../../kernel/system";
import { type CyberwareSlot, cyberwareCatalog, SLOT_CAPACITY, SLOT_LABELS } from "../cyberware";
import type { DamageTier } from "../dice";
import { BODY_PART_LABELS, type BodyPart, INJURY_HEAL_MINUTES } from "../health";
import { neuralDisplay, neuralStage, STAGE_LABELS } from "../humanity";
import { itemCatalog } from "../inventory";
import {
  NPC_CHROME_MAX,
  NPC_GEAR_MAX,
  type Npc,
  type NpcBodyCard,
  type NpcChrome,
  type NpcCondition,
  type NpcGear,
  type NpcHeal,
  type NpcHumanity,
  type NpcHurt,
  type NpcInjury,
  type NpcScan,
  type NpcVitals,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;
function objectHolder(data: Data, id: string): string | undefined {
  const objects = data.worldObjects as Record<string, { holder?: unknown }> | undefined;
  const holder = objects?.[id]?.holder;
  return typeof holder === "string" ? holder : undefined;
}

export const NPC_DAMAGE_LABELS: Readonly<Record<DamageTier, string>> = {
  graze: "擦伤",
  heavy: "重伤",
  lethal: "致命伤",
};
const DAMAGE_ORDER: Readonly<Record<DamageTier, number>> = {
  lethal: 3,
  heavy: 2,
  graze: 1,
};

const PART_HINTS: readonly (readonly [BodyPart, RegExp])[] = [
  ["left-arm", /左(臂|手|腕|肘|前臂|手掌)/],
  ["right-arm", /右(臂|手|腕|肘|前臂|手掌)/],
  ["left-leg", /左(腿|脚|膝|踝|大腿|小腿)/],
  ["right-leg", /右(腿|脚|膝|踝|大腿|小腿)/],
  ["head", /头|颅|脑|后脑|太阳穴|额角/],
  ["face", /脸|面|眼|耳|鼻|嘴|腮|下巴|眉/],
  ["belly", /腹|肚|胃|肋|腰|脾/],
  ["chest", /胸|心口|背|脊|锁骨|肩/],
];

/** 模型没填 part 时，按致伤描述里的解剖词兜底归位；匹配不到返回 null */
function inferBodyPart(reason: string): BodyPart | null {
  for (const [part, pattern] of PART_HINTS) {
    if (pattern.test(reason)) return part;
  }
  return null;
}

export const EMPTY_NPC_BODY: NpcBodyCard = { gear: [], cyberware: [] };
export type FilledBody = NpcBodyCard;

/** 没写身体时补成空武装与空义体 */
export function filledBody(body: NpcBodyCard | undefined): FilledBody {
  const b = body ?? EMPTY_NPC_BODY;
  return {
    ...b,
    gear: [...b.gear],
    cyberware: [...b.cyberware],
  };
}

/** 运行期对模型写的 body 做温和解析与清理：支持按中文名回退、剔除表外或超格的项，不因单项笔误丢整张卡 */
export function sanitizeNpcBody(
  body: NpcBodyCard,
  data: Data,
  notes: string[],
  npcId?: string,
): NpcBodyCard {
  const hasItemCatalog = Array.isArray(data.items);
  const items = hasItemCatalog ? itemCatalog(data) : null;
  const itemByName = items
    ? new Map([...items.values()].map((def) => [def.name.trim().toLowerCase(), def.id]))
    : null;

  const gear: string[] = [];
  const droppedGear: string[] = [];
  for (const raw of body.gear) {
    if (gear.length >= NPC_GEAR_MAX) break;
    let id = raw;
    if (items && !items.has(id)) {
      const hit = itemByName?.get(raw.trim().toLowerCase());
      if (hit) id = hit;
      else {
        droppedGear.push(raw);
        continue;
      }
    }
    const holder = objectHolder(data, id);
    if (holder !== undefined && holder !== npcId) {
      notes.push(`物件 ${id} 当前属于 ${holder}，先实际转交，不能在人物卡中复制`);
      continue;
    }
    if (!gear.includes(id)) gear.push(id);
  }
  if (droppedGear.length > 0) {
    notes.push(`略去物品表外装备：${droppedGear.join("、")}`);
  }

  const hasChromeCatalog = Array.isArray(data.cyberware);
  const chrome = hasChromeCatalog ? cyberwareCatalog(data) : null;
  const chromeByName = chrome
    ? new Map([...chrome.values()].map((def) => [def.name.trim().toLowerCase(), def.id]))
    : null;

  const cyberware: string[] = [];
  const droppedChrome: string[] = [];
  const slotCounts = new Map<CyberwareSlot, number>();
  for (const raw of body.cyberware) {
    if (cyberware.length >= NPC_CHROME_MAX) break;
    let id = raw;
    if (chrome && !chrome.has(id)) {
      const hit = chromeByName?.get(raw.trim().toLowerCase());
      if (hit) id = hit;
      else {
        droppedChrome.push(raw);
        continue;
      }
    }
    if (cyberware.includes(id)) continue;
    const def = chrome?.get(id);
    if (def) {
      const used = slotCounts.get(def.slot) ?? 0;
      if (used >= SLOT_CAPACITY[def.slot]) {
        droppedChrome.push(`${def.name}（${SLOT_LABELS[def.slot]}已满）`);
        continue;
      }
      slotCounts.set(def.slot, used + 1);
    }
    cyberware.push(id);
  }
  if (droppedChrome.length > 0) {
    notes.push(`略去无效或超格义体：${droppedChrome.join("、")}`);
  }

  return {
    ...body,
    gear,
    cyberware,
  };
}

/** 卡上写的物品和义体 id 是不是都在表里；返回问题列表 */
export function bodyProblems(body: NpcBodyCard | undefined, data: Data, npcId?: string): string[] {
  if (!body) return [];
  const problems: string[] = [];
  if (body.gear.length > 0) {
    const items = itemCatalog(data);
    for (const id of body.gear) {
      if (!items.has(id)) problems.push(`物品表里没有「${id}」`);
      const holder = objectHolder(data, id);
      if (holder !== undefined && holder !== npcId)
        problems.push(`独立物件 ${id} 属于 ${holder}，不能给人物重复配置`);
    }
  }
  if (body.cyberware.length > 0) {
    const chrome = cyberwareCatalog(data);
    for (const id of body.cyberware) if (!chrome.has(id)) problems.push(`义体表里没有「${id}」`);
    problems.push(...slotProblems(body.cyberware, chrome));
  }
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

/** 根据实际创口和治疗期计算此刻状况；显示条不参与结算。 */
export function currentVitals(
  npc: Pick<Npc, "body" | "vitals"> & Partial<Pick<Npc, "alive">>,
  _data: Data,
  now: number,
): NpcVitals & { readonly hp: number; readonly max: number; readonly humanity: number } {
  const v: NpcVitals = npc.vitals ?? {
    condition: "up",
    nextInjuryId: 1,
    hurtAt: null,
    scannedAt: null,
    injuries: [],
    symptoms: (npc.body?.symptoms ?? []).map((s) => ({ ...s, at: now })),
  };
  const injuries = v.injuries.filter((i) => i.healsAt === null || now < i.healsAt);
  const condition = npc.alive === false ? "dead" : v.condition;
  const hp =
    condition !== "up"
      ? 0
      : injuries.some((i) => i.tier === "lethal")
        ? 20
        : injuries.some((i) => i.tier === "heavy")
          ? 50
          : injuries.length
            ? 90
            : 100;
  return {
    ...v,
    condition,
    injuries,
    symptoms: [...v.symptoms],
    hp,
    max: 100,
    humanity: neuralDisplay(v),
  };
}
export function woundLabel(v: Pick<NpcVitals, "condition" | "injuries">): string {
  if (v.condition === "dead") return "死亡";
  if (v.condition === "dying") return "濒死，需急救";
  if (v.condition === "down") return "倒下";
  if (v.injuries.some((i) => i.tier === "lethal")) return "重创，恢复中";
  if (v.injuries.some((i) => i.tier === "heavy")) return "重伤";
  return v.injuries.length ? "擦伤" : "没受伤";
}
function settle(npc: Npc, data: Data, now: number): { body: FilledBody; v: NpcVitals } {
  const body = filledBody(npc.body);
  const { hp: _hp, max: _max, humanity: _humanity, ...v } = currentVitals(npc, data, now);
  npc.body = body;
  npc.vitals = v;
  return { body, v };
}

/** 交战同步昏迷或苏醒事实，不臆造创口，也不覆盖尚未救治的濒死。 */
export function applyNpcCondition(
  npc: Npc,
  command: NpcCondition,
  now: number,
  data: Data,
): ApplyOutcome {
  if (!npc.alive) return { ok: false, reason: `${npc.name} 已经死亡` };
  const { v } = settle(npc, data, now);
  if (
    command.condition === "up" &&
    (v.condition === "dying" || v.injuries.some((i) => i.tier === "lethal" && !i.treated))
  ) {
    return { ok: false, reason: "致命伤尚未稳定，不能仅靠状态切换恢复行动" };
  }
  if (!(command.condition === "down" && v.condition === "dying")) v.condition = command.condition;
  return { ok: true, notes: [`${npc.name}：${command.reason}`] };
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
      const { v } = settle(npc, data, now);
      if (v.condition === "dead") return { ok: false, reason: `${npc.name} 已经死亡` };
      const part = command.part ?? inferBodyPart(command.reason);
      v.injuries.push({
        id: `ni${v.nextInjuryId++}`,
        part,
        tier: command.tier,
        cause: command.reason,
        at: now,
        treated: false,
        healsAt: command.tier === "graze" ? now + INJURY_HEAL_MINUTES.graze : null,
      });
      v.hurtAt = now;
      if (command.tier === "lethal") v.condition = "dying";
      return {
        ok: true,
        notes: [
          `${npc.name} ${part ? BODY_PART_LABELS[part] : "身体"}${NPC_DAMAGE_LABELS[command.tier]}：${command.reason}`,
        ],
      };
    }
    case "npcHeal": {
      const { v } = settle(npc, data, now);
      if (v.condition === "dead") return { ok: false, reason: `${npc.name} 已经死亡` };
      if (command.how !== "ripperdoc")
        return {
          ok: true,
          notes: [
            `${npc.name} ${command.how === "rest" ? "休整中" : "缓解疼痛"}，具体创口仍需恢复`,
          ],
        };
      for (const injury of v.injuries) {
        injury.treated = true;
        injury.healsAt ??= now + INJURY_HEAL_MINUTES[injury.tier];
      }
      v.condition = "up";
      return { ok: true, notes: [`${npc.name} 已接受稳定与清创处理，具体伤处进入恢复期`] };
    }
    case "npcGear": {
      const def = itemCatalog(data).get(command.item);
      if (!def) return { ok: false, reason: `物品表里没有「${command.item}」` };
      const { body } = settle(npc, data, now);
      const has = body.gear.includes(command.item);
      if (command.action === "add") {
        const holder = objectHolder(data, command.item);
        if (holder !== undefined && holder !== npc.id)
          return {
            ok: false,
            reason: `独立物件当前属于 ${holder}；先用 item lose recipient:${npc.id} 实际转交`,
          };
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
      const verb = command.action === "install" ? "装上了" : "拆掉了";
      const swapNote = swapped === undefined ? "" : `，换下了 ${swapped}`;
      return { ok: true, notes: npc.met ? [`${npc.name} ${verb} ${def.name}${swapNote}`] : [] };
    }
    case "npcHumanity": {
      const { v } = settle(npc, data, now);
      const i = v.symptoms.findIndex((s) => s.id === command.symptomId);
      if (command.action === "recover") {
        if (i < 0) return { ok: false, reason: `没有症状 ${command.symptomId}` };
        v.symptoms.splice(i, 1);
      } else {
        if (!command.stage || !command.symptom) return { ok: false, reason: "需要实际症状与阶段" };
        const entry = {
          id: command.symptomId,
          stage: command.stage,
          description: command.symptom,
          cause: command.reason,
          at: now,
        };
        if (i < 0) v.symptoms.push(entry);
        else v.symptoms[i] = entry;
      }
      return { ok: true };
    }
    case "npcScan": {
      const { v } = settle(npc, data, now);
      v.scannedAt = now;
      return { ok: true, notes: [`扫描了 ${npc.name}`] };
    }
  }
}

interface GearDetail {
  readonly id: string;
  readonly name: string;
}

function gearDetails(ids: readonly string[], data: Data): GearDetail[] {
  if (ids.length === 0) return [];
  const items = itemCatalog(data);
  return ids.map((id) => ({ id, name: items.get(id)?.name ?? id }));
}

/** 一件义体的稳定标识、名字、部位和效果说明（义体表的 ability） */
export interface ChromeDetail {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  readonly ability: string;
  readonly netTag?: "deck" | "selfIce";
}

/**
 * 义体不再只是一串名字（用户 2026-11-02："npc的义体是不是太简单了，只有一个文字描述"）：
 * 叙事模型和扫描面板都拿到部位和效果说明
 */
export function chromeDetails(ids: readonly string[], data: Data): ChromeDetail[] {
  if (ids.length === 0) return [];
  const catalog = cyberwareCatalog(data);
  return ids.map((id) => {
    const def = catalog.get(id);
    if (!def) return { id, name: id, slot: "", ability: "" };
    const netTag =
      def.id === "self-ice"
        ? ("selfIce" as const)
        : def.slot === "os" && def.deckTraits !== undefined
          ? ("deck" as const)
          : undefined;
    return {
      id,
      name: def.name,
      slot: SLOT_LABELS[def.slot],
      ability: def.ability,
      ...(netTag ? { netTag } : {}),
    };
  });
}

function chromeText(list: readonly ChromeDetail[]): string {
  if (list.length === 0) return "没有";
  return list
    .map((c) => (c.ability ? `${c.name}（${c.slot}：${c.ability.replace(/。$/, "")}）` : c.name))
    .join("、");
}

/** 一条具象伤势的投影结构 */
export interface NpcInjuryView {
  readonly id: string;
  readonly part: BodyPart | null;
  readonly partLabel: string;
  readonly tier: DamageTier;
  readonly tierLabel: string;
  readonly cause: string;
  readonly at: number;
  readonly treated: boolean;
}

function projectInjuries(injuries: readonly NpcInjury[]): NpcInjuryView[] {
  return [...injuries]
    .sort((a, b) => DAMAGE_ORDER[b.tier] - DAMAGE_ORDER[a.tier] || b.at - a.at)
    .map((inj) => ({
      id: inj.id,
      part: inj.part,
      partLabel: inj.part ? BODY_PART_LABELS[inj.part] : "躯干",
      tier: inj.tier,
      tierLabel: NPC_DAMAGE_LABELS[inj.tier],
      cause: inj.cause,
      at: inj.at,
      treated: inj.treated,
    }));
}

function injurySummaryText(injuries: readonly NpcInjuryView[]): string {
  return injuries
    .map((i) => `${i.partLabel}${i.tierLabel}：${i.cause}${i.treated ? "（已处理）" : ""}`)
    .join("；");
}

/** 完整卡上的一行身体：定性伤势与具体创口、装备、义体（带部位和效果）、人性阶段；不输出 RPG 阶层或属性数字 */
export function bodyLine(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): string {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const injuries = projectInjuries(v.injuries);
  const woundText =
    injuries.length > 0 ? `${woundLabel(v)}（${injurySummaryText(injuries)}）` : woundLabel(v);
  const gear = gearDetails(body.gear, data).map((item) => item.name);
  const chrome = chromeDetails(body.cyberware, data);
  return [
    `身体状态：${woundText}`,
    `装备：${gear.length ? gear.join("、") : "没有"}`,
    `义体：${chromeText(chrome)}`,
    `人性状态：${STAGE_LABELS[neuralStage(v)]}`,
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
  if (v.condition === "up" && v.injuries.length === 0) return undefined;
  const injuries = projectInjuries(v.injuries);
  const head = injuries[0];
  if (head) {
    return `${woundLabel(v)}（${head.partLabel}${head.tierLabel}：${head.cause}${injuries.length > 1 ? ` 等 ${injuries.length} 处` : ""}）`;
  }
  return woundLabel(v);
}

/** 玩家视图里的身体：见过的人看伤势（含具体创口）、装备；扫描过的看实际义体配置与精神/人性稳定度，不展示游戏数值 */
export interface NpcBodyView {
  readonly wound: string;
  readonly injuries: readonly NpcInjuryView[];
  readonly gear: readonly GearDetail[];
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
    wound: woundLabel(v),
    injuries: projectInjuries(v.injuries),
    gear: gearDetails(body.gear, data),
    scan: null,
  };
  if (v.scannedAt === null) return view;
  return {
    ...view,
    scan: {
      chrome: chromeDetails(body.cyberware, data),
      humanityStage: STAGE_LABELS[neuralStage(v)],
      at: v.scannedAt,
    },
  };
}
