import type { PlayerView } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { RuleModule } from "../../kernel/system";
import { effectiveTurns, type LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { evaluatePhysicsBoundaries, type NarrativeIntensity } from "../../physics";
import type { TurnInput } from "../../schemas/turn";
import { CyberwareStateSchema, cyberwareSection } from "../../systems/cyberware";
import { EconomyStateSchema } from "../../systems/economy/schema";
import { consequenceSection } from "../../systems/fallout";
import { deckOf, mentionsHacking, npcDeckOf } from "../../systems/hacking";
import { HackingStateSchema } from "../../systems/hacking/schema";
import { HealthStateSchema } from "../../systems/health";
import {
  catalogSection,
  itemCatalog,
  summarizeAbility,
  weaponDisplayNames,
  withWorldObjects,
} from "../../systems/inventory";
import {
  carriedWeaponIds,
  effectiveWeaponNoise,
  InventoryStateSchema,
  type ItemDef,
  loadoutSummary,
  MOD_SLOT_LABELS,
  ModSlotSchema,
  type WeaponType,
  weaponGrantsSmartLink,
} from "../../systems/inventory/schema";
import { jobTemplateSection } from "../../systems/jobs";
import { MemoryStateSchema, memoryRecords, recapSection } from "../../systems/memory";
import { NpcStateSchema, onStage } from "../../systems/npc";
import { registry } from "../../systems/registry";
import { SafehouseStateSchema } from "../../systems/safehouse/schema";
import { currentTension } from "../../systems/tension";
import { locationCatalog, WorldClockStateSchema, withSavedPlaces } from "../../systems/world";
import { canonSection } from "../canon";
import { twistSection } from "../examples";
import { merchantContext } from "../merchant-context";
import { sceneMemorySection } from "../scene-memory";
import type { Memory } from "../stages";

/**
 * 各步共用的材料：当前状态、人物、委托、近期后果、到期事件、物理与安防约束、物品与地点表、玩家输入的写法。
 * 这些填进 L2 任务模板的槽位；模板和各层的拼法在 layers.ts
 */

/** 原文最多带这么多轮；实际带几轮由上下文预算定（至少 3 轮），没记预算的旧记录按这个数重建 */
export const HISTORY_TURNS = 12;

/** 开场只看是否已有有效回合，不能因未定稿原文被排除而重置已推进的故事。 */
export function activeOpening(
  records: readonly LogRecord[],
  opening: string | undefined,
): string | undefined {
  return effectiveTurns(records).some((turn) => turn.draft !== true) ? undefined : opening;
}

/** 【前情】：已经收场、原文不在最近 hot 轮里的场景摘要；没有时为 undefined。maxTokens 是预算给的额度 */
export function recapFor(
  world: WorldState,
  records: readonly LogRecord[],
  hot: number,
  maxTokens?: number,
): string | undefined {
  const turns = effectiveTurns(memoryRecords(world, records));
  const shown = new Set(
    (hot > 0 ? turns.slice(-hot) : [])
      .map((t) => t.scene)
      .filter((s): s is number => s !== undefined),
  );
  const text = recapSection(MemoryStateSchema.parse(world.slices.memory ?? {}), shown, maxTokens);
  return text === undefined ? undefined : `【前情】\n${text}`;
}

/** 常驻核心负责说明的指令；其余指令由各系统的规则模块说明 */
export const CORE_COMMANDS = ["world", "humanity", "item", "damage", "heal", "deadline"] as const;

export type NarratorPlan = { readonly kind: "action"; readonly input: TurnInput };

/** 旧存档的输入方式 */
const MODE_LABELS: Readonly<Record<NonNullable<TurnInput["mode"]>, string>> = {
  do: "做",
  say: "说",
  think: "想",
  ooc: "出戏",
};

export { catalogSection } from "../../systems/inventory";

/** 提示词里随存档而定、但不在世界状态里的东西 */
export interface PromptExtras {
  /** 静态数据表；带物品表时写进系统提示词 */
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  /** 这个存档的开场设定；故事还没开始时放进最后一条消息 */
  readonly opening?: string | undefined;
  /** 写正文之前代码已经定下的事：场外提问、物理定性裁决、出行耗时 */
  readonly decided?: readonly string[] | undefined;
  /** ① 判断调出的旧记忆；写正文时单独放一栏 */
  readonly recalled?: readonly Memory[] | undefined;
  /** 设定库查到的原作资料，已经拼成单独的引用块；只给写正文那一步 */
  readonly lore?: string | undefined;
  /** 写正文带几轮原文（上下文预算定的）；没给按 HISTORY_TURNS */
  readonly history?: number | undefined;
  /** 【前情】的 token 额度；没给不截 */
  readonly recapTokens?: number | undefined;
  /** 开场的游戏时间；按它算原剧时间线走到第几天，没给就不带 */
  readonly startTime?: number | undefined;
  /** 本轮是否启用写作预设；启用时不叠加默认表达、示例、节律与修辞提醒。 */
  readonly hasPreset?: boolean | undefined;
  /** 未启用预设时的柔性场景烈度 */
  readonly intensity?: NarrativeIntensity | undefined;
}

export function stateSummary(
  world: WorldState,
  records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>> = {},
): string {
  // 各系统交自己的几行，按 order 穿插排好；这里只负责投影和拼接
  const views = registry.project({ world, records, data });
  return registry.status({ views }).join("\n");
}

export function formatInput(input: TurnInput): string {
  const boost = input.sandevistan ? "【开斯安威斯坦】" : "";
  const reply = input.replyTo !== undefined ? `【回复消息 #${input.replyTo}】` : "";
  const bd =
    input.braindance === undefined
      ? ""
      : input.braindance === "abandon"
        ? "【退出超梦，没下结论】"
        : "【超梦下结论，对错见【超梦】】";
  return input.mode
    ? `【${MODE_LABELS[input.mode]}】${boost}${bd}${reply}${input.text}`
    : `【玩家】${boost}${bd}${reply}${input.text}`;
}

export interface NarratorPrompt {
  readonly messages: readonly LlmMessage[];
  /** 本轮带上的规则模块 id，记进回合日志，上下文查看器用 */
  readonly modules: readonly string[];
  /** 规则层的字数：守则、阶段说明、输出约定和规则模块，不含物品表这类数据表 */
  readonly rules: number;
  /** 写正文那一步各部分粗估多少 token（上下文预算用）；别的步骤没有 */
  readonly parts?: Readonly<Record<string, number>> | undefined;
}

/** 判断只看最近几轮的原文 */
export const JUDGE_TURNS = 4;

/** 抽取核对 ID 的完整简表；长能力说明按本轮相关性放入用户消息，创作参考不进记账。 */
export function tablesOf(_view: PlayerView, extras: PromptExtras): string[] {
  if (!extras.data) return [];
  return [
    catalogSection(extras.data, false),
    cyberwareSection(extras.data, false),
    jobTemplateSection(extras.data),
  ].filter((s): s is string => s !== undefined);
}

/** 写正文只带剧情素材，不带 id 查阅表 */
export function narrateTablesOf(_view: PlayerView, extras: PromptExtras): string[] {
  if (!extras.data) return [];
  return [twistSection(extras.data), consequenceSection(extras.data)].filter(
    (s): s is string => s !== undefined,
  );
}

const DISTRICT_ID_MAP: Readonly<Record<string, string>> = {
  市政中心: "city-center",
  市中心: "city-center",
  公司广场: "city-center",
  威斯特布鲁克: "westbrook",
  日本街: "westbrook",
  宪章山: "westbrook",
  北橡区: "westbrook",
  沃森: "watson",
  海伍德: "heywood",
  圣多明戈: "santo-domingo",
  太平洲: "pacifica",
};

const DIRECT_LINK = /(?:个人连接线|直插|数据线|插孔)/;
const AIR_GAP_HINT = /(?:气隙|离线隔离|物理断网|air[- ]?gapped)/i;
const UNCHROMED_HINT = /(?:纯肉体|没装义体|无义体|纯机械)/;
const HARDENED_ICE_HINT =
  /(?:公司数据堡垒|军用黑冰|硬化黑冰|自卫黑冰|自我\s*ICE|网络黑客|网监|军用防火墙)/i;
const SUBNET_MENTION = /([\u4e00-\u9fa5A-Za-z0-9·-]{2,14}(?:内网|子网))/;
const SUBNET_GATE = /(?:隔离|封闭|必须先渗入|局域网|本地子网)/;
const HIGH_END_VENUE =
  /(?:进门|大门|过安检|走进|进入|混进).*?(?:大厦|塔|会所|俱乐部|vip|顶层|余烬|绀碧|酒店)/i;

const MOD_SLOTS = ModSlotSchema.options;

const WEAPON_TYPE_TACTICS: Readonly<Record<WeaponType, string>> = {
  power: "威能（跳弹打击；常规轻口径正面难穿重型战术甲，须瞄准弱点、侧翼绕射或近距压制）",
  tech: "技术（电磁蓄力可穿透轻薄掩体与中轻护甲；不支持常规机械消音）",
  smart: "智能（联锁就绪时微陀螺弹头可绕半身掩体追踪；强电磁干扰与实心厚墙会阻断弹道）",
};

function buildWeaponAdvisories(
  inv: ReturnType<typeof InventoryStateSchema.parse>,
  items: ReadonlyMap<string, ItemDef>,
  installed: readonly { readonly id: string }[],
  brokenChrome: readonly string[],
): string[] {
  const weaponIds = carriedWeaponIds(inv, items);
  if (weaponIds.length === 0) return [];

  const displayNames = weaponDisplayNames(weaponIds, inv.objects, items);
  const brokenSet = new Set(brokenChrome);
  const hasHandSmartLink = installed.some((c) => c.id === "smart-link" && !brokenSet.has(c.id));
  const brokenHandSmartLink =
    !hasHandSmartLink && installed.some((c) => c.id === "smart-link" && brokenSet.has(c.id));

  const silencedGuns: string[] = [];
  const loudGuns: string[] = [];
  const meleeWeapons: string[] = [];
  const smartMissing: string[] = [];
  const smartReady: string[] = [];
  const typeNotes = new Set<string>();
  const modNotes: string[] = [];

  for (const id of weaponIds) {
    const obj = inv.objects[id];
    const def = items.get(id) ?? obj?.definition;
    if (def?.kind !== "weapon" || def.category === undefined) continue;
    const ws = obj?.weaponState;
    const name = displayNames.get(id) ?? def.name;
    const isMelee = def.category === "blade" || def.category === "blunt";
    const noise = effectiveWeaponNoise(def, ws, items);

    if (isMelee) {
      meleeWeapons.push(name);
      typeNotes.add("近战（贴身破防与无声压制受距离与身法约束）");
    } else {
      if (noise === "silent") silencedGuns.push(name);
      else loudGuns.push(name);
      if (def.weaponType) typeNotes.add(WEAPON_TYPE_TACTICS[def.weaponType]);
    }

    if (def.weaponType === "smart") {
      if (hasHandSmartLink || weaponGrantsSmartLink(def, ws, items)) {
        smartReady.push(name);
      } else {
        smartMissing.push(name);
      }
    }

    if (ws) {
      for (const slot of MOD_SLOTS) {
        const modId = ws.mods[slot];
        if (!modId) continue;
        const modDef = items.get(modId);
        const summary = summarizeAbility(modDef?.ability, 44);
        modNotes.push(
          `${name} [${MOD_SLOT_LABELS[slot]}] ${modDef?.name ?? modId}${summary ? `：${summary}` : ""}`,
        );
      }
    }
  }

  const advisories: string[] = [];
  if (silencedGuns.length > 0 && loudGuns.length > 0) {
    advisories.push(
      `随身武器声学：已消音枪械（${silencedGuns.join("、")}）压低枪口爆鸣，远距不易触发枪声警报（近距机械声、倒地动静、视线与监控仍可暴露）；未消音枪械（${loudGuns.join("、")}）开火会传出明显枪声惊动附近守卫与目击者`,
    );
  } else if (silencedGuns.length > 0) {
    advisories.push(
      `随身武器声学：当前枪械（${silencedGuns.join("、")}）已消音，开火不产生远距爆鸣声，但近距动静、倒地、视线与监控仍受现场约束`,
    );
  } else if (loudGuns.length > 0) {
    advisories.push(
      `随身武器声学：当前枪械（${loudGuns.join("、")}）均未消音，开火会立即传出清晰枪声，极易惊动附近守卫与目击者`,
    );
  } else if (meleeWeapons.length > 0) {
    advisories.push(
      `随身武器声学：仅携带近战武器（${meleeWeapons.join("、")}），无枪声暴露风险（仍受视线、搏斗声与监控约束）`,
    );
  }

  if (smartMissing.length > 0) {
    advisories.push(
      `智能武器联锁缺失（${smartMissing.join("、")}）：${brokenHandSmartLink ? "手部智能连接义体已损坏停机" : "未植入有效手部智能连接义体"}且武器未装自主智能校准模组，微陀螺弹头无法激活电子自导，只能作普通低精度直瞄使用（不硬性阻断开火）`,
    );
  }
  if (smartReady.length > 0) {
    advisories.push(
      `智能武器联锁就绪（${smartReady.join("、")}）：${hasHandSmartLink ? "手部智能连接" : "武器内置/外置智能校准模组"}已建立自导数据链，可锁定目标发射微陀螺追踪弹头`,
    );
  }
  if (typeNotes.size > 0) {
    advisories.push(`武器体系参考：${[...typeNotes].join("；")}`);
  }
  if (modNotes.length > 0) {
    advisories.push(`已装改装能力：${modNotes.join("；")}`);
  }
  return advisories;
}

/** 计算当前局面客观触发的物理与安防约束（余额、高安区明火武器/高档场所门禁、无接入仓与物理网络拓扑） */
export function physicsSection(
  world: WorldState,
  data: Readonly<Record<string, unknown>> | undefined,
  inputText: string,
): string | undefined {
  const safeData = data ?? {};
  const economy = EconomyStateSchema.parse(world.slices.economy ?? {});
  const clock = WorldClockStateSchema.parse(world.slices.world ?? {});
  const mergedData = withSavedPlaces(safeData, world);
  const place = clock.location ? locationCatalog(mergedData).get(clock.location) : undefined;
  const districtId = place ? (DISTRICT_ID_MAP[place.district] ?? place.district) : undefined;

  const inv = InventoryStateSchema.safeParse(world.slices.inventory);
  const items = safeData.items
    ? itemCatalog(withWorldObjects(safeData, inv.success ? inv.data.objects : {}))
    : new Map<string, ItemDef>();
  const cyber = CyberwareStateSchema.safeParse(world.slices.cyberware ?? {});
  const health = HealthStateSchema.safeParse(world.slices.health ?? {});
  const installed = cyber.success ? cyber.data.installed : [];
  const brokenChrome = health.success ? health.data.brokenChrome : [];
  const loadout = inv.success
    ? loadoutSummary(inv.data, items, { installed, brokenChrome })
    : undefined;
  const weaponAdvisories = inv.success
    ? buildWeaponAdvisories(inv.data, items, installed, brokenChrome)
    : [];

  const hacking = HackingStateSchema.safeParse(world.slices.hacking ?? {});
  const safehouse = SafehouseStateSchema.safeParse(world.slices.safehouse ?? {});
  const inSafehouse =
    clock.location !== null &&
    safehouse.success &&
    safehouse.data.homes.some((h) => h.location === clock.location);

  const deckInfo = deckOf(installed, safeData, brokenChrome);
  const hasCyberdeck = deckInfo
    ? deckInfo.deck !== null
    : hacking.success && hacking.data.deck !== null && !brokenChrome.includes(hacking.data.deck);

  const wantHack = mentionsHacking(inputText) || (hacking.success && hacking.data.dive !== null);
  let hackCheck: Parameters<typeof evaluatePhysicsBoundaries>[0]["hackCheck"];
  if (wantHack && hacking.success) {
    const breachedHere = hacking.data.breachedNetworks
      .filter((b) => b.location === clock.location || b.location === null)
      .map((b) => b.name);
    const tension = currentTension(world);
    const activeEnemyChrome = tension.scannedEnemyChrome.filter(
      (c) => !tension.disabledEnemyChrome.includes(c),
    );
    const activeSceneText =
      MemoryStateSchema.safeParse(world.slices.memory ?? {}).data?.active?.text ?? "";
    const sceneContext = [
      place?.note ?? "",
      activeSceneText,
      ...tension.exposedWeakpoints,
      ...activeEnemyChrome,
      inputText,
    ]
      .filter(Boolean)
      .join("\n");

    const npcs = NpcStateSchema.safeParse(world.slices.npc ?? {});
    const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
    const targetedNpcs = npcs.success
      ? Object.values(npcs.data.npcs).filter(
          (n) =>
            onStage(n, stage) &&
            (inputText.includes(n.name) ||
              (n.alias !== undefined && n.alias !== "" && inputText.includes(n.alias)) ||
              inputText.includes(n.id)),
        )
      : [];

    const targetAirGapped = AIR_GAP_HINT.test(sceneContext);
    const targetUnchromed =
      UNCHROMED_HINT.test(inputText) ||
      (targetedNpcs.length > 0 &&
        targetedNpcs.every((n) => n.body !== undefined && n.body.cyberware.length === 0));

    const vector = DIRECT_LINK.test(inputText)
      ? "directLink"
      : breachedHere.length > 0 && /(?:子网|内网|摄像头|门禁|炮塔|终端|本地)/.test(inputText)
        ? "localSubnet"
        : "wireless";

    const subnetCandidate =
      SUBNET_GATE.test(sceneContext) ||
      SUBNET_MENTION.test(activeSceneText) ||
      SUBNET_MENTION.test(place?.note ?? "")
        ? SUBNET_MENTION.exec(sceneContext)?.[1]
        : undefined;
    const requiredSubnet = vector === "localSubnet" ? breachedHere[0] : subnetCandidate;

    const npcHasHardenedChrome = targetedNpcs.some((n) => {
      if (!n.body) return false;
      const info = npcDeckOf(n.body.cyberware, safeData);
      return info.deck !== null || info.selfIce;
    });
    const hardenedIce =
      npcHasHardenedChrome ||
      (hacking.data.dive !== null && hacking.data.dive.layer >= 3) ||
      place?.district === "市政中心" ||
      place?.district === "公司广场" ||
      HARDENED_ICE_HINT.test(sceneContext);

    hackCheck = {
      vector,
      hasCyberdeck,
      breachedSubnets: breachedHere,
      ...(targetAirGapped ? { targetAirGapped: true } : {}),
      ...(requiredSubnet ? { requiredSubnet } : {}),
      ...(targetUnchromed ? { targetUnchromed: true } : {}),
      ...(hardenedIce ? { hardenedIce: true } : {}),
    };
  }

  const result = evaluatePhysicsBoundaries({
    currentEddies: economy.eddies,
    ...(districtId && loadout
      ? {
          securityCheck: {
            districtId,
            weaponConcealment: loadout.concealment,
            ...(inSafehouse ? { inSafehouse: true } : {}),
            ...(HIGH_END_VENUE.test(inputText) ? { enteringHighEndVenue: true } : {}),
          },
        }
      : {}),
    ...(loadout?.bulkyOverloaded
      ? {
          bulkyOverload: {
            count: loadout.bulkyCount,
            max: loadout.bulkyMax,
            items: loadout.bulkyItems,
          },
        }
      : {}),
    ...(hackCheck ? { hackCheck } : {}),
    ...(weaponAdvisories.length > 0 ? { weaponAdvisories } : {}),
  });

  if (result.directives.length === 0) return undefined;
  return result.directives.map((d) => `- ${d}`).join("\n");
}

/** 各步共用的局面：状态、人物、委托、物理约束、近期后果、到期事件、开场 */
export function situation(
  world: WorldState,
  records: readonly LogRecord[],
  view: PlayerView,
  plan: NarratorPlan,
  extras: PromptExtras,
): string[] {
  const input =
    plan.kind === "action"
      ? { text: plan.input.text, braindance: plan.input.braindance }
      : { text: "" };
  const parts = [
    `【当前状态】\n${stateSummary(world, records, extras.data)}`,
    ...registry.sections({ world, data: extras.data, input }),
  ];
  const sceneMemory = sceneMemorySection(world, input.text);
  const market = merchantContext(view, input.text);
  if (market) parts.push(market);
  if (sceneMemory) parts.push(sceneMemory);
  const physics = physicsSection(world, extras.data, input.text);
  if (physics) parts.push(`【物理与安防现状】\n${physics}`);
  const canon = canonSection(extras.data, extras.startTime, world.time);
  if (canon) parts.push(`【原剧时间线】\n${canon}`);
  if (extras.opening && view.totalTurns === 0) parts.push(`【开场】\n${extras.opening}`);
  return parts;
}

/** 开了斯安威斯坦时的说明；没开或开不了时为 undefined */
export function boostNote(
  view: PlayerView,
  plan: NarratorPlan,
  stage: "judge" | "narrate",
): string | undefined {
  if (plan.input.sandevistan !== true || !view.sandevistan) return undefined;
  const { name } = view.sandevistan;
  return `【斯安威斯坦时刻】\n玩家要求开启${name}。根据实际距离、身体动作、设备状态和对手反应判断能完成什么，不设固定动作格；快速破解的上传、装填和物体运动各有实际耗时。${stage === "narrate" ? "写出加速感知和动作的可见结果；只有实际出现的过热、神经症状或损伤才记后果，不按使用次数扣人性。" : "在 ruling 中说明具体可行条件与阻碍，不替玩家追加动作。"}`;
}

/** 写正文与抽取阶段的模块激活：除玩家输入外，敌方黑客反制裁决或正文涉及黑客攻防时补齐 hackingRules。 */
export function stageModules(
  world: WorldState,
  input: TurnInput,
  extras: PromptExtras,
  narrative?: string,
): readonly RuleModule[] {
  const base = registry.activeRules(world, input);
  if (input.mode === "ooc" || base.some((m) => m.id === "hacking")) return base;
  const hasCounterHack =
    extras.decided?.some((line) => line.startsWith("【敌方黑客反制】")) ?? false;
  const narrativeHack = narrative !== undefined && mentionsHacking(narrative);
  if (!hasCounterHack && !narrativeHack) return base;
  return registry.rules.filter((m) => m.id === "hacking" || base.includes(m));
}
