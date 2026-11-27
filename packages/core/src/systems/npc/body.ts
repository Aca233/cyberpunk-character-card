import type { ApplyOutcome } from "../../kernel/system";
import {
  type CyberwareDef,
  checkCyberwareInstall,
  cyberwareCatalog,
  cyberwareConflicts,
  SLOT_LABELS,
} from "../cyberware";
import type { DamageTier } from "../dice";
import { RARITY_LABELS, type Rarity } from "../economy";
import { BODY_PART_LABELS, type BodyPart, INJURY_HEAL_MINUTES } from "../health";
import { neuralDisplay, neuralStage, STAGE_LABELS } from "../humanity";
import {
  CLOTHING_SLOT_LABELS,
  type ClothingSlot,
  defaultInstanceStateFromDef,
  formatWeaponWithMods,
  ITEM_KIND_LABELS,
  type ItemDef,
  type ItemKind,
  itemCatalog,
  itemEffectTags,
  MOD_SLOT_LABELS,
  PROTECTION_COVERAGE_LABELS,
  PROTECTION_LEVEL_LABELS,
  rarityOf,
  summarizeGearEffects,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  type WeaponInstanceState,
  WeaponInstanceStateSchema,
} from "../inventory";
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

function worldObjectWeaponState(data: Data, id: string): WeaponInstanceState | undefined {
  const objects = data.worldObjects as Record<string, { weaponState?: unknown }> | undefined;
  const parsed = WeaponInstanceStateSchema.safeParse(objects?.[id]?.weaponState);
  return parsed.success ? parsed.data : undefined;
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
  const normalizeChromeKey = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\p{P}·•・]/gu, "");
  const chromeByName = chrome
    ? new Map([...chrome.values()].map((def) => [normalizeChromeKey(def.name), def.id]))
    : null;
  // 模型偶发写出常见简称时温和归位到目录内基础义体，避免静默清空整栏。
  const chromeAliases: Readonly<Record<string, string>> = {
    kiroshi: "kiroshi-mk1",
    kiroshimk1: "kiroshi-mk1",
    岐路司: "kiroshi-mk1",
    岐路司义眼: "kiroshi-mk1",
    岐路司光学义眼: "kiroshi-mk1",
    岐路司光学义眼mk1: "kiroshi-mk1",
    岐路司义眼1型: "kiroshi-mk1",
    岐路司义眼mk1: "kiroshi-mk1",
    基础义眼: "kiroshi-mk1",
    普通义眼: "kiroshi-mk1",
    义眼: "kiroshi-mk1",
    岐路司mk2: "kiroshi-mk2",
    岐路司义眼mk2: "kiroshi-mk2",
    生物监测器: "biomonitor",
    合成肺: "syn-lungs",
    义肢手臂: "prosthetic-arms",
    通用义肢: "prosthetic-arms",
    义肢腿: "prosthetic-legs",
    猩猩臂: "gorilla-arms",
    猩猩手臂: "gorilla-arms",
    军用科技平行线: "militech-paraline",
    平行线接入仓: "militech-paraline",
    基础接入仓: "militech-paraline",
  };

  const cyberware: string[] = [];
  const placedDefs: CyberwareDef[] = [];
  const droppedChrome: string[] = [];
  for (const raw of body.cyberware) {
    if (cyberware.length >= NPC_CHROME_MAX) break;
    let id = raw;
    if (chrome && !chrome.has(id)) {
      const normalized = normalizeChromeKey(raw);
      const aliasTarget = chromeAliases[normalized];
      const hit =
        chromeByName?.get(normalized) ??
        (aliasTarget && chrome.has(aliasTarget) ? aliasTarget : undefined);
      if (hit) id = hit;
      else {
        droppedChrome.push(raw);
        continue;
      }
    }
    if (cyberware.includes(id)) continue;
    const def = chrome?.get(id);
    if (def) {
      const check = checkCyberwareInstall(def, placedDefs);
      if (!check.ok) {
        droppedChrome.push(`${def.name}（${check.reason}）`);
        continue;
      }
      placedDefs.push(def);
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
 * 按 v2 三道约束校验 NPC 义体（与玩家完全同一套规则）：
 * 1. 物理互斥（8 核心主位、装植减缩器、5 组显性同类器官）；
 * 2. 4 个功能扩展区人体空间上限（外观生活区无上限）；
 * 3. 三段式神经承载硬顶（原生 50 / 装植减缩 70 / 双子星 FBC 70 / 重装战甲 FBC 90）。
 */
export function slotProblems(
  ids: readonly string[],
  chrome: ReadonlyMap<string, CyberwareDef>,
): string[] {
  const problems: string[] = [];
  const placed: CyberwareDef[] = [];
  for (const id of ids) {
    const def = chrome.get(id);
    if (!def) continue;
    const check = checkCyberwareInstall(def, placed);
    if (!check.ok) {
      problems.push(`${def.name}：${check.reason}`);
      continue;
    }
    placed.push(def);
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
      const items = itemCatalog(data);
      const def = items.get(command.item);
      if (!def) return { ok: false, reason: `物品表里没有「${command.item}」` };
      const ws = worldObjectWeaponState(data, command.item) ?? defaultInstanceStateFromDef(def);
      const displayName = ws ? formatWeaponWithMods(def.name, ws, items) : def.name;
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
        return { ok: true, notes: npc.met ? [`${npc.name} 拿上了 ${displayName}`] : [] };
      }
      if (!has) return { ok: false, reason: `${npc.name} 的装备栏里没有 ${displayName}` };
      npc.body = { ...body, gear: body.gear.filter((g) => g !== command.item) };
      return { ok: true, notes: npc.met ? [`${npc.name} 不再带着 ${displayName}`] : [] };
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
        // 物理互斥组满额时换下同互斥组最早装的那件，非互斥义体直接加装
        const installedDefs = body.cyberware.flatMap((c) => {
          const d = catalog.get(c);
          return d ? [d] : [];
        });
        const conflict = cyberwareConflicts(def, installedDefs);
        const out = conflict.ok ? undefined : conflict.blockers[0]?.id;
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
      for (const [device, state] of Object.entries(npc.behaviorChips ?? {})) {
        if (!npc.body?.cyberware.includes(device) && state.mode !== "off") {
          state.mode = "off";
          state.protocol = null;
          state.since = now;
          if (state.lastControl && state.lastControl.to === null) state.lastControl.to = now;
        }
      }
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
      const alreadyScanned = v.scannedAt !== null;
      v.scannedAt = now;
      if (alreadyScanned) {
        // 重复扫描/复扫仅静默刷新档案时间戳，不重复写入界面行动提示与下一轮正文上下文
        return { ok: true };
      }
      const tactical = scanTacticalProfile(npc, data, now);
      return {
        ok: true,
        notes: [
          `用义眼扫描了 ${npc.name}：威胁「${tactical.threatLabel}」；${tactical.netLabel}${tactical.summaryBits.length > 0 ? `；${tactical.summaryBits.join("；")}` : ""}`,
        ],
      };
    }
  }
}

export interface GearDetail {
  readonly id: string;
  readonly baseId?: string;
  readonly name: string;
  readonly kind: ItemKind;
  readonly subLabel: string;
  readonly clothingSlot?: ClothingSlot;
  readonly rarity: Rarity | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly ability: string | null;
  readonly effectTags: readonly string[];
}

const CLOTHING_SLOT_ORDER: Readonly<Record<ClothingSlot, number>> = {
  head: 0,
  face: 1,
  outer: 2,
  inner: 3,
  legs: 4,
  feet: 5,
};

function gearSubLabel(def: ItemDef | undefined): string {
  if (!def) return "未登记物品";
  if (def.kind === "weapon") {
    return [
      def.weaponType ? WEAPON_TYPE_LABELS[def.weaponType] : null,
      def.category ? WEAPON_CATEGORY_LABELS[def.category] : null,
    ]
      .filter(Boolean)
      .join("");
  }
  if (def.kind === "clothing" && def.clothingSlot) return CLOTHING_SLOT_LABELS[def.clothingSlot];
  if (def.kind === "mod" && def.modSlot) return `改装 · ${MOD_SLOT_LABELS[def.modSlot]}`;
  if (def.braindanceDevice?.playback) {
    return (def.braindanceDevice.analysis.length ?? 0) > 0 ? "超梦编辑头环" : "超梦花环";
  }
  if (def.chipDevice) return def.chipDevice === "reader-writer" ? "隔离读写器" : "芯片阅读器";
  if (def.chipContentId || def.chipStorage) return def.chipContentId ? "神经芯片" : "空白芯片";
  return ITEM_KIND_LABELS[def.kind];
}

function gearDetails(ids: readonly string[], data: Data): GearDetail[] {
  if (ids.length === 0) return [];
  const items = itemCatalog(data);
  return ids.map((id) => {
    const def = items.get(id);
    const ws =
      worldObjectWeaponState(data, id) ?? (def ? defaultInstanceStateFromDef(def) : undefined);
    const baseDef = def ?? (ws ? items.get(ws.baseId) : undefined);
    const baseName = baseDef?.name ?? id;
    const name = ws ? formatWeaponWithMods(baseName, ws, items) : baseName;
    const rarity =
      baseDef && (baseDef.rarity || baseDef.kind === "weapon") ? rarityOf(baseDef) : null;
    return {
      id,
      ...(ws && ws.baseId !== id ? { baseId: ws.baseId } : {}),
      name,
      kind: baseDef?.kind ?? "misc",
      subLabel: gearSubLabel(baseDef),
      ...(baseDef?.kind === "clothing" && baseDef.clothingSlot
        ? { clothingSlot: baseDef.clothingSlot }
        : {}),
      rarity,
      rarityLabel: baseDef?.iconic ? "不朽" : rarity ? RARITY_LABELS[rarity] : null,
      iconic: Boolean(baseDef?.iconic),
      ability: baseDef?.ability ?? null,
      effectTags: baseDef ? itemEffectTags(baseDef) : [],
    };
  });
}

function npcGearEffects(ids: readonly string[], data: Data) {
  const items = itemCatalog(data);
  const clothing: Partial<Record<ClothingSlot, string>> = {};
  const backpack: Record<string, number> = {};
  for (const id of ids) {
    const def = items.get(id);
    if (def?.kind === "clothing" && def.clothingSlot && !clothing[def.clothingSlot]) {
      clothing[def.clothingSlot] = id;
    } else {
      backpack[id] = (backpack[id] ?? 0) + 1;
    }
  }
  return summarizeGearEffects({ clothing, backpack, objects: {} }, items);
}

function armorSummaryFromProtection(
  protection: Readonly<
    Partial<Record<"head" | "torso" | "limbs", "light" | "ballistic" | "heavy">>
  >,
): string[] {
  const result: string[] = [];
  for (const part of ["head", "torso", "limbs"] as const) {
    const level = protection[part];
    if (level) result.push(`${PROTECTION_COVERAGE_LABELS[part]}${PROTECTION_LEVEL_LABELS[level]}`);
  }
  return result;
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
    const netTag = def.defenses?.includes("ice")
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

/** 完整卡上的一行身体：定性伤势与具体创口、衣着/武器/随身物品、义体（带部位和效果）、人性阶段；不输出 RPG 阶层或属性数字 */
export function bodyLine(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): string {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const injuries = projectInjuries(v.injuries);
  const woundText =
    injuries.length > 0 ? `${woundLabel(v)}（${injurySummaryText(injuries)}）` : woundLabel(v);
  const details = gearDetails(body.gear, data);
  const clothing = details
    .filter((item) => item.kind === "clothing")
    .sort(
      (a, b) =>
        (a.clothingSlot ? CLOTHING_SLOT_ORDER[a.clothingSlot] : 9) -
        (b.clothingSlot ? CLOTHING_SLOT_ORDER[b.clothingSlot] : 9),
    );
  const weapons = details.filter((item) => item.kind === "weapon");
  const belongings = details.filter((item) => item.kind !== "clothing" && item.kind !== "weapon");
  const gearEffects = npcGearEffects(body.gear, data);
  const chrome = chromeDetails(body.cyberware, data);
  const segments = [`身体状态：${woundText}`];
  if (clothing.length > 0) {
    segments.push(`衣着：${clothing.map((item) => `${item.name}（${item.subLabel}）`).join("、")}`);
  }
  if (gearEffects.badges.length > 0) {
    segments.push(`着装防护与效果：${gearEffects.badges.join("、")}`);
  }
  segments.push(`武装：${weapons.length ? weapons.map((item) => item.name).join("、") : "无"}`);
  if (belongings.length > 0) {
    segments.push(`随身物品：${belongings.map((item) => item.name).join("、")}`);
  }
  segments.push(`义体：${chromeText(chrome)}`, `人性状态：${STAGE_LABELS[neuralStage(v)]}`);
  return segments.join("；");
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

export type ScanNetStatus = "unchromed" | "open" | "selfIce" | "netrunner";

export interface ScanTacticalProfile {
  readonly threat: "low" | "even" | "high";
  readonly threatLabel: string;
  readonly netStatus: ScanNetStatus;
  readonly netLabel: string;
  readonly summaryBits: readonly string[];
  readonly tips: readonly string[];
}

/** 基于 NPC 真实义体、随身武装与伤势，生成可供义眼扫描展示与战术判断的定性情报（零骰、无虚拟数值） */
export function scanTacticalProfile(
  npc: Pick<Npc, "body" | "vitals">,
  data: Data,
  now: number,
): ScanTacticalProfile {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const catalog = cyberwareCatalog(data);
  const chromeDefs = body.cyberware
    .map((id) => catalog.get(id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const chrome = chromeDetails(body.cyberware, data);
  const details = gearDetails(body.gear, data);
  const gearEffects = npcGearEffects(body.gear, data);
  const weapons = details.filter((item) => item.kind === "weapon");
  const injuries = projectInjuries(v.injuries);

  const hasDeck = chrome.some((c) => c.netTag === "deck");
  const hasSelfIce = chrome.some((c) => c.netTag === "selfIce");
  const hasArmor = chromeDefs.some((d) => d.armor);
  const hasHeavyGearArmor =
    gearEffects.protection.torso === "heavy" || gearEffects.protection.head === "heavy";
  const hasBallisticGearArmor =
    gearEffects.protection.torso === "ballistic" || gearEffects.protection.head === "ballistic";
  const hasAccel = chromeDefs.some((d) => d.accelerator);
  const hasArmWeapon = chromeDefs.some((d) => d.slot === "arms");
  const hasBehaviorChip = chromeDefs.some((d) => d.behaviorChip);
  const highGradeChrome = chromeDefs.filter(
    (d) => d.iconic || d.rarity === "legendary" || d.rarity === "epic",
  );
  const hasHeavyWeapon = weapons.some(
    (w) =>
      w.subLabel.includes("步枪") ||
      w.subLabel.includes("霰弹") ||
      w.subLabel.includes("狙击") ||
      w.subLabel.includes("机枪") ||
      w.iconic,
  );

  // 1. 骇入链路判断
  let netStatus: ScanNetStatus;
  let netLabel: string;
  if (chrome.length === 0) {
    netStatus = "unchromed";
    netLabel = "无植入体（无线快速破解不可锁定）";
  } else if (hasDeck) {
    netStatus = "netrunner";
    netLabel = hasSelfIce
      ? "敌方网络黑客（含接入仓与自我 ICE，强骇易遭反制）"
      : "敌方网络黑客（装有接入仓，小心远程反骇）";
  } else if (hasSelfIce) {
    netStatus = "selfIce";
    netLabel = "已装自我 ICE（常规无线快速破解易被首轮拦截）";
  } else {
    netStatus = "open";
    netLabel = "无自我 ICE（可直接无线快速破解其义体）";
  }

  // 2. 威胁定级
  let threat: "low" | "even" | "high" = "low";
  let threatLabel = "常规目标";
  if (
    v.condition === "dying" ||
    v.condition === "dead" ||
    injuries.some((i) => i.tier === "lethal")
  ) {
    threat = "low";
    threatLabel = "重创失能";
  } else if (
    hasAccel ||
    highGradeChrome.length >= 2 ||
    ((hasArmor || hasHeavyGearArmor) && (hasArmWeapon || hasHeavyWeapon || hasDeck)) ||
    chrome.length >= 5
  ) {
    threat = "high";
    threatLabel = "高危改装";
  } else if (
    chrome.length >= 2 ||
    hasArmor ||
    hasHeavyGearArmor ||
    hasBallisticGearArmor ||
    hasDeck ||
    hasArmWeapon ||
    hasHeavyWeapon ||
    weapons.length >= 1
  ) {
    threat = "even";
    threatLabel = "持械实战";
  }

  // 3. 简洁摘要 & 实战战术提示
  const summaryBits: string[] = [];
  const tips: string[] = [];

  if (chrome.length === 0) {
    summaryBits.push("未检出义体");
    tips.push("纯肉体目标：无法无线快速破解，近身压制与常规枪械均无义体护甲阻拦");
  } else {
    const names = chrome.slice(0, 3).map((c) => c.name);
    summaryBits.push(
      `检出 ${chrome.length} 件义体（${names.join("、")}${chrome.length > 3 ? "等" : ""}）`,
    );
  }

  if (hasAccel) {
    const accelName = chromeDefs.find((d) => d.accelerator)?.name ?? "神经加速义体";
    tips.push(`装有${accelName}：正面先手爆发极高，建议抢攻、伏击或先用义体过热/干扰压制`);
  }
  if (hasArmor) {
    const armorName = chromeDefs.find((d) => d.armor)?.name ?? "护甲义体";
    tips.push(
      `带${armorName}：常规轻口径手枪正面难破防，优先用技术武器、大口径、近战或瞄准无甲弱点`,
    );
  }
  const wornArmorParts = (["head", "torso", "limbs"] as const).flatMap((part) => {
    const level = gearEffects.protection[part];
    return level === "heavy" || level === "ballistic"
      ? [`${PROTECTION_COVERAGE_LABELS[part]}${PROTECTION_LEVEL_LABELS[level]}`]
      : [];
  });
  if (wornArmorParts.length > 0) {
    summaryBits.push(`穿戴护甲：${wornArmorParts.join("、")}`);
    tips.push(
      hasHeavyGearArmor
        ? `身穿重型护甲（${wornArmorParts.join("、")}）：普通枪弹正面难击穿，优先用穿甲/技术武器、大口径或瞄准无甲缝隙`
        : `穿有防弹护具（${wornArmorParts.join("、")}）：正面抗弹较强，建议点射未防护部位或用破甲火力压制`,
    );
  }
  if (hasArmWeapon) {
    const armName = chromeDefs.find((d) => d.slot === "arms")?.name ?? "内置手臂武装";
    tips.push(`隐蔽武装${armName}：哪怕空手也有贴身致命输出，别放松近距戒备`);
  }
  if (hasDeck) {
    tips.push("持有网络接入仓：交火或僵持时可能远程过热/锁死你的义体，优先断视线或先手解决");
  } else if (netStatus === "open") {
    tips.push("义体无自我 ICE 防护：若有接入仓可直接无线锁义眼、卡武器或烧毁硬件");
  } else if (netStatus === "selfIce") {
    tips.push("带自我 ICE：初次无线骇入会被拦截，需靠高阶接入仓强破或改走物理压制");
  }
  if (hasBehaviorChip) {
    tips.push("植入了行为芯片：可能处于托管/改装协议状态，也易受敌方黑客远程干扰");
  }
  if (weapons.length > 0) {
    summaryBits.push(`随身武装：${weapons.map((w) => w.name).join("、")}`);
  }
  const untreated = injuries.filter((i) => !i.treated);
  if (untreated.length > 0) {
    const head = untreated[0];
    if (head) {
      summaryBits.push(`${head.partLabel}${head.tierLabel}未愈`);
      tips.push(
        `可趁伤势发难：${head.partLabel}${head.tierLabel}（${head.cause}）会影响其闪避与发力`,
      );
    }
  }
  const stage = neuralStage(v);
  if (stage === "unstable" || stage === "edge" || stage === "crisis") {
    tips.push(
      `神经稳态偏低（${STAGE_LABELS[stage]}）：情绪与判断易受刺激波动，交涉或施压时可针对施压`,
    );
  }

  return {
    threat,
    threatLabel,
    netStatus,
    netLabel,
    summaryBits,
    tips: tips.slice(0, 4),
  };
}

/** 玩家视图里的身体：见过的人看伤势（含具体创口）、装备；扫描过的看实际义体配置、战术评估与精神/人性稳定度，不展示游戏数值 */
export interface NpcBodyView {
  readonly wound: string;
  readonly injuries: readonly NpcInjuryView[];
  readonly gear: readonly GearDetail[];
  readonly armorSummary: readonly string[];
  readonly gearBadges: readonly string[];
  readonly scan: {
    readonly chrome: readonly ChromeDetail[];
    readonly humanityStage: string;
    readonly threat: "low" | "even" | "high";
    readonly threatLabel: string;
    readonly netStatus: ScanNetStatus;
    readonly netLabel: string;
    readonly tips: readonly string[];
    readonly at: number;
  } | null;
}

export function bodyView(npc: Pick<Npc, "body" | "vitals">, data: Data, now: number): NpcBodyView {
  const body = filledBody(npc.body);
  const v = currentVitals(npc, data, now);
  const gearEffects = npcGearEffects(body.gear, data);
  const view: NpcBodyView = {
    wound: woundLabel(v),
    injuries: projectInjuries(v.injuries),
    gear: gearDetails(body.gear, data),
    armorSummary: armorSummaryFromProtection(gearEffects.protection),
    gearBadges: gearEffects.badges,
    scan: null,
  };
  if (v.scannedAt === null) return view;
  const tactical = scanTacticalProfile(npc, data, now);
  return {
    ...view,
    scan: {
      chrome: chromeDetails(body.cyberware, data),
      humanityStage: STAGE_LABELS[neuralStage(v)],
      threat: tactical.threat,
      threatLabel: tactical.threatLabel,
      netStatus: tactical.netStatus,
      netLabel: tactical.netLabel,
      tips: tactical.tips,
      at: v.scannedAt,
    },
  };
}
