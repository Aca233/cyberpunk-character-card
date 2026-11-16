import type { PlayerView } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import { effectiveTurns, type LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { evaluatePhysicsBoundaries, type NarrativeIntensity } from "../../physics";
import type { TurnInput } from "../../schemas/turn";
import { CyberwareStateSchema, cyberwareSection } from "../../systems/cyberware";
import { EconomyStateSchema } from "../../systems/economy/schema";
import { consequenceSection } from "../../systems/fallout";
import { HackingStateSchema } from "../../systems/hacking/schema";
import { HealthStateSchema } from "../../systems/health";
import { catalogSection, itemCatalog } from "../../systems/inventory";
import { InventoryStateSchema, loadoutSummary } from "../../systems/inventory/schema";
import { jobTemplateSection } from "../../systems/jobs";
import { MemoryStateSchema, memoryRecords, recapSection } from "../../systems/memory";
import { registry } from "../../systems/registry";
import { SafehouseStateSchema } from "../../systems/safehouse/schema";
import { locationCatalog, WorldClockStateSchema, withSavedPlaces } from "../../systems/world";
import { canonSection } from "../canon";
import { twistSection } from "../examples";
import { sceneMemorySection } from "../scene-memory";
import type { Memory } from "../stages";

/**
 * 各步共用的材料：当前状态、人物、委托、近期后果、到期事件、物理与安防约束、物品与地点表、玩家输入的写法。
 * 这些填进 L2 任务模板的槽位；模板和各层的拼法在 layers.ts
 */

/** 原文最多带这么多轮；实际带几轮由上下文预算定（至少 3 轮），没记预算的旧记录按这个数重建 */
export const HISTORY_TURNS = 12;

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

const HACK_ATTEMPT = /(?:快速破解|骇入|入侵|潜网|接入点|子网|断网|直插|终端|摄像头|防火墙)/;
const DIRECT_LINK = /(?:个人连接线|直插|数据线|插孔)/;
const HIGH_END_VENUE =
  /(?:进门|大门|过安检|走进|进入|混进).*?(?:大厦|塔|会所|俱乐部|vip|顶层|余烬|绀碧|酒店)/i;

/** 计算当前局面客观触发的物理与安防约束（余额、高安区明火武器/高档场所门禁、无接入仓骇入） */
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
  const items = safeData.items ? itemCatalog(safeData) : new Map();
  const cyber = CyberwareStateSchema.safeParse(world.slices.cyberware ?? {});
  const health = HealthStateSchema.safeParse(world.slices.health ?? {});
  const loadout = inv.success
    ? loadoutSummary(inv.data, items, {
        installed: cyber.success ? cyber.data.installed : [],
        brokenChrome: health.success ? health.data.brokenChrome : [],
      })
    : undefined;

  const hacking = HackingStateSchema.safeParse(world.slices.hacking ?? {});
  const safehouse = SafehouseStateSchema.safeParse(world.slices.safehouse ?? {});
  const inSafehouse =
    clock.location !== null &&
    safehouse.success &&
    safehouse.data.homes.some((h) => h.location === clock.location);

  const wantHack = HACK_ATTEMPT.test(inputText);
  const vector = DIRECT_LINK.test(inputText) ? "directLink" : "wireless";
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
    ...(wantHack && hacking.success
      ? {
          hackCheck: {
            vector,
            hasCyberdeck: hacking.data.deck !== null,
            breachedSubnets: hacking.data.breachedNetworks.map((b) => b.name),
          },
        }
      : {}),
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
