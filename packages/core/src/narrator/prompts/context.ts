import type { PlayerView } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import { effectiveTurns, type LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import type { TurnInput } from "../../schemas/turn";
import { cyberwareSection } from "../../systems/cyberware";
import { ATTRIBUTE_LABELS } from "../../systems/dice";
import { consequenceSection } from "../../systems/fallout";
import { DAMAGE_LABELS } from "../../systems/health";
import { catalogSection } from "../../systems/inventory";
import { jobTemplateSection } from "../../systems/jobs";
import { MemoryStateSchema, recapSection } from "../../systems/memory";
import { registry } from "../../systems/registry";
import { canonSection } from "../canon";
import { twistSection } from "../examples";
import type { RolledCheck } from "../pending";
import type { Memory } from "../stages";

/**
 * 各步共用的材料：当前状态、人物、委托、到期事件、物品和地点表、玩家输入的写法。
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
  const turns = effectiveTurns(records);
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

export type NarratorPlan =
  | { readonly kind: "action"; readonly input: TurnInput }
  /** 玩家确认了检定，骰子已经写进日志，这一轮写结果 */
  | { readonly kind: "resolve"; readonly input: TurnInput; readonly check: RolledCheck };

/** 旧存档的输入方式 */
const MODE_LABELS: Readonly<Record<NonNullable<TurnInput["mode"]>, string>> = {
  do: "做",
  say: "说",
  think: "想",
  ooc: "出戏",
};

const OUTCOME_LABELS = {
  critical: "大成功",
  success: "成功",
  failure: "失败",
  fumble: "大失败",
} as const;

export { catalogSection } from "../../systems/inventory";

/** 提示词里随存档而定、但不在世界状态里的东西 */
export interface PromptExtras {
  /** 静态数据表；带物品表时写进系统提示词 */
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  /** 这个存档的开场设定；故事还没开始时放进最后一条消息 */
  readonly opening?: string | undefined;
  /** 写正文之前代码已经定下的事：场外提问、先给检定、门槛结果 */
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
  const boost = `${input.sandevistan ? "【开斯安威斯坦】" : ""}${input.overclock ? "【超频义体】" : ""}${
    input.pay
      ? input.pay.pay === "flesh"
        ? "【这一下皮肉硬吃】"
        : input.pay.pay === "chrome"
          ? `【这一下拿义体 ${input.pay.chrome ?? ""} 去挡】`
          : `【这一下舍掉肢体 ${input.pay.limb ?? ""}】`
      : ""
  }`;
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

export function checkResultText(rolled: RolledCheck): string {
  const { prepared, result, offer } = rolled;
  const spec = offer.spec;
  const faces =
    result.faces.length > 1
      ? `${result.faces[0]}（再掷 ${result.faces[1]}）`
      : `${result.faces[0]}`;
  const lines = [
    `【检定结果】${ATTRIBUTE_LABELS[spec.attribute]}检定，难度值 ${prepared.dv}：掷出 ${faces}，加检定值 ${prepared.modifier}，合计 ${result.total} → ${OUTCOME_LABELS[result.outcome]}`,
    `事先说明——成功：${spec.success}；失败：${spec.failure}${spec.damage ? `；失败最多${DAMAGE_LABELS[spec.damage]}` : "；失败不扣血"}`,
    "按这个结果写这一轮的正文，正文里不提骰子和数值；失败时后果不比事先说明的更重。",
  ];
  return lines.join("\n");
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

/** 物品、义体、地点等表：写正文和抽取都要用 id */
export function tablesOf(view: PlayerView, extras: PromptExtras): string[] {
  if (!extras.data) return [];
  return [
    catalogSection(extras.data),
    cyberwareSection(extras.data),
    twistSection(extras.data),
    jobTemplateSection(extras.data),
    consequenceSection(extras.data, view.difficulty),
  ].filter((s): s is string => s !== undefined);
}

/**
 * 写正文只带剧情素材（用户 2026-10-31："越来越像游戏而不是角色扮演了"，同意改："可以"）：
 * 物品、义体、地点表和委托模板是给抽取对 id 用的，抽取那一步自己带着；写正文只输出纯文本，用不上
 */
export function narrateTablesOf(view: PlayerView, extras: PromptExtras): string[] {
  if (!extras.data) return [];
  return [twistSection(extras.data), consequenceSection(extras.data, view.difficulty)].filter(
    (s): s is string => s !== undefined,
  );
}

/** 各步共用的局面：状态、人物、委托、近期后果、到期事件、开场和检定结果 */
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
  const canon = canonSection(extras.data, extras.startTime, world.time);
  if (canon) parts.push(`【原剧时间线】\n${canon}`);
  if (extras.opening && view.totalTurns === 0) parts.push(`【开场】\n${extras.opening}`);
  if (plan.kind === "resolve") parts.push(checkResultText(plan.check));
  return parts;
}

/** 开了斯安威斯坦时的说明；没开或开不了时为 undefined */
export function boostNote(
  view: PlayerView,
  plan: NarratorPlan,
  stage: "judge" | "narrate",
): string | undefined {
  // 当场掷骰的轮次也算（用户 2026-11-01 选的「全改」）：确认检定那条路的输入不带斯安威斯坦，不受影响
  if (plan.input.sandevistan !== true || !view.sandevistan) return undefined;
  const { name, slots } = view.sandevistan;
  return stage === "judge"
    ? `【斯安威斯坦时刻】\n玩家开了${name}：这一瞬间最多做 ${slots} 个动作（快速破解、换武器、扔手雷各占一格）。所有真正不确定的部分合并成一次 check，事先在 failure 里写明失败时哪几个动作会落空。`
    : `【斯安威斯坦时刻】\n玩家开了${name}：这一瞬间最多做 ${slots} 个动作（快速破解、换武器、扔手雷各占一格），超出的按顺序不执行，正文里写明哪几件没来得及。把这些动作写成一段连贯的慢动作。人性已经由代码扣过。`;
}
