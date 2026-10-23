import { type PlayerView, projectState } from "../game";
import type { LlmMessage } from "../kernel/ports";
import type { RuleModule } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import type { TurnInput } from "../schemas/turn";
import {
  ATTRIBUTE_LABELS,
  type Attribute,
  BONUS_CAP,
  DV_MOD_CAP,
  OPPONENT_TIERS,
  PENALTY_CAP,
} from "../systems/dice";
import { DAMAGE_LABELS } from "../systems/health";
import { registry } from "../systems/registry";
import { BlockDocSchema, STATE_CLOSE, STATE_OPEN } from "./block";
import { commandDoc, schemaDoc } from "./doc";
import type { RolledCheck } from "./pending";

/**
 * 主持人提示词：常驻核心在前，按状态挑出的规则模块在后，两者都只随规则变化；
 * 每轮都变的状态、检定结果和玩家输入放在最后一条消息里，前缀能命中提示缓存
 */

/** 带最近这么多轮原文；更早的先丢，场景压缩在 M3 */
export const HISTORY_TURNS = 12;

/** 常驻核心负责说明的指令；其余指令由各系统的规则模块说明 */
export const CORE_COMMANDS = ["world", "humanity", "item", "damage", "heal", "deadline"] as const;

export type GmPlan =
  | { readonly kind: "action"; readonly input: TurnInput }
  /** 玩家确认了检定，骰子已经写进日志，这一轮写结果 */
  | { readonly kind: "resolve"; readonly input: TurnInput; readonly check: RolledCheck };

const MODE_LABELS: Readonly<Record<TurnInput["mode"], string>> = {
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

const tiers = Object.entries(OPPONENT_TIERS)
  .map(([id, t]) => `${id}（${t.label}）${t.dv[0]}–${t.dv[1]}`)
  .join("，");

const attributes = Object.entries(ATTRIBUTE_LABELS)
  .map(([id, label]) => `${id} ${label}`)
  .join("、");

const CORE = `你是《赛博朋克 2077》世界观下文字冒险的主持人，用简体中文写作，叙述用第二人称“你”。

【意图优先】
- 建议选项只是建议，自由输入是一等公民。先理解玩家想达成什么，再决定世界怎么回应；合理的办法直接让它发生，并写出代价。
- 对话、求助、观察、询问、合理的日常行动默认不掷骰。聪明的计划、充分的准备、利用人物关系和环境，可以免检定、降低难度值或获得加成，正文写明凭什么。免检定不免代价：时间、人情、痕迹或热度至少付一项。
- 不可能的事直接说做不到，并给出代价更高的替代方向，不用骰子掩饰。
- 玩家声称拥有的能力、物品、义体、人脉，必须在角色资料或物品栏里找得到；找不到时可以让玩家试着“装作有”，但不能凭空生效。已确定的事实和死亡不能推翻。
- 公平但冷酷：不偏袒也不刁难，坏选择有坏结果，好办法有好结果。NPC 有自己的意愿和边界，好感高不等于言听计从。

【不替玩家角色说话】
- 不替玩家角色说台词、决定感受或做重大决定；只写世界和 NPC 怎么回应，以及身体上不由自主的反应（手抖、心跳加快、伤口发疼）。
- 玩家写的台词照原话放进正文，不改写不润色；动作可以展开描写，但不加玩家没写的意图。
- 需要角色表态时停下来，用建议选项或留白交给玩家，不替玩家回答。

【四种输入】
- 【做】行动；【说】角色说出口的话；【想】只有角色自己知道的念头，NPC 听不到，不能被当成对话回应。
- 【出戏】玩家在场外提问：用一两句话直接回答，不推进剧情；指令块里 changes 写 []、check 写 null。问“能不能行”时只说大致可行性和会不会要检定，不给难度值。

【判定】按固定顺序：
1. 说服、谈判：先看有没有说中对方的诉求或触到底线，不看数值。
2. 门槛：属性达标直接成功，不掷骰。门槛前期 4–8，中期 9–14，后期 15–20；选项可以带 gate，代码判断达不达标。
3. 只有结果真不确定、失败有意义的后果、成败都能让故事继续时才掷骰：这一轮正文只写到行动将要发生（一两句），在指令块给出 check，写清 success 和 failure，不写结果，停笔等玩家确认。代码掷骰后会再请你写结果。
- 属性：${attributes}。
- 难度值的基础值按对手档位给：${tiers}；没有对手的环境风险（攀爬、追车路况、恶劣天气）按同一张表选相当的档位。
- 加成 bonuses（本事、义体、物品、人物、准备，每项 +2）合计最多 +${BONUS_CAP}；减值 penalties（伤势、恶劣环境）合计最多 −${PENALTY_CAP}；基础值之上的难度修正 dvMods 合计最多 +${DV_MOD_CAP}。代码统一截断。
- 失败可能受伤时在 check 写 damage（graze 擦伤、heavy 重击、lethal 致命）；只有写了 lethal 才可能死，不写 damage 失败就不扣血。
- 检定结果出来后照事先说明的写：失败后果不比 failure 更重，剧情照样往前走。
- 建议选项可以预先带 check，玩家选中就直接掷骰。

【写作】
- 每轮 150–400 字，等检定的那一轮更短；停在需要玩家回应的地方。
- 正文不写数值和规则术语，状态由代码记账。暴力和成人题材按原作基调写，不刻意回避也不猎奇渲染。`;

function formatSection(): string {
  const commands = CORE_COMMANDS.map((type) => {
    const schema = registry.commandSchema(type);
    if (!schema) throw new Error(`常驻核心说明的 ${type} 不是模型可用的指令`);
    return commandDoc(type, schema);
  });
  return `【回复格式】
正文在前，末尾附一个指令块，块里是一个 JSON 对象，不要用代码块包起来：
${STATE_OPEN}
${schemaDoc(BlockDocSchema)}
${STATE_CLOSE}
- 字段后的问号表示可以不写，括号里是说明。
- changes 每轮都要有一条 world；没有别的变化就只写这一条。
- id 用小写英文和连字符，例如地点 kabuki-market。

changes 可用的指令：
${commands.join("\n")}

例：
你压低帽檐，跟着那个中间人拐进市场后巷。
${STATE_OPEN}
{"read": "你想跟踪中间人，看他去见谁", "choices": [{"text": "继续跟上去"}, {"text": "翻上棚顶居高观察", "check": {"intent": "不被发现地翻上棚顶", "attribute": "reflexes", "tier": "street", "dv": 11, "success": "看清他和谁接头", "failure": "铁皮响动惊动了他", "damage": "graze"}}], "check": null, "changes": [{"type": "world", "activity": "observe", "location": "kabuki-market"}]}
${STATE_CLOSE}`;
}

function moduleSection(module: RuleModule): string {
  const commands = (module.commands ?? []).map((type) =>
    commandDoc(
      type,
      registry.commandSchema(type) as NonNullable<ReturnType<typeof registry.commandSchema>>,
    ),
  );
  return [
    `【规则：${module.title}】`,
    module.text,
    ...(commands.length > 0 ? ["相关指令：", ...commands] : []),
  ].join("\n");
}

let core: string | undefined;

/** 常驻核心；第一次用时检查每种模型可用的指令都有说明 */
export function coreRules(): string {
  if (core === undefined) {
    const documented = new Set<string>([
      ...CORE_COMMANDS,
      ...registry.rules.flatMap((m) => m.commands ?? []),
    ]);
    const missing = registry.commandTypes().filter((t) => !documented.has(t));
    if (missing.length > 0) throw new Error(`这些指令没有写进任何规则模块：${missing.join("、")}`);
    core = `${CORE}\n\n${formatSection()}`;
  }
  return core;
}

export function systemPrompt(modules: readonly RuleModule[]): string {
  return [coreRules(), ...modules.map(moduleSection)].join("\n\n");
}

function attributeLine(values: Readonly<Record<Attribute, number>>): string {
  return (Object.keys(ATTRIBUTE_LABELS) as Attribute[])
    .map((a) => `${ATTRIBUTE_LABELS[a]} ${values[a]}`)
    .join("，");
}

export function stateSummary(view: PlayerView): string {
  const c = view.character;
  const lines = [
    `角色：${c.name ?? "（还没建档）"}${c.brief ? `。${c.brief}` : ""}`,
    `属性：${attributeLine(c.attributes)}；街头声望 ${c.streetCred}`,
    `时间：${view.time.text}（${view.time.periodLabel}）`,
    `地点：${view.location ?? "尚未确定，由你在开场时安排"}`,
    `生命：${view.health.hp}/${view.health.max}，${view.health.conditionLabel}${view.health.wound ? `，${view.health.wound}` : ""}`,
    `人性：${view.humanity.current}/${view.humanity.cap}，${view.humanity.stageLabel}`,
  ];
  const weapons = view.inventory.weapons.filter((w): w is string => w !== null);
  lines.push(`武器栏：${weapons.length > 0 ? weapons.join("、") : "空手"}`);
  if (view.inventory.healing)
    lines.push(`治疗品：${view.inventory.healing.id}，剩 ${view.inventory.healing.charges} 次`);
  const backpack = Object.entries(view.inventory.backpack);
  if (backpack.length > 0)
    lines.push(`背包：${backpack.map(([id, n]) => `${id}×${n}`).join("、")}`);
  if (view.combat.active) {
    const a = view.combat.active;
    const enemies = a.enemies.map((e) => `${e.group}（${e.tier}，${e.count} 人）`).join("、");
    lines.push(
      `战斗中：第 ${a.moment}/${a.moments} 次交锋，敌人 ${enemies}，败局是「${a.defeat}」`,
    );
    if (a.dyingMomentsLeft !== null)
      lines.push(`濒死：还剩 ${a.dyingMomentsLeft} 次交锋内要被救回`);
  }
  for (const d of view.deadlines) {
    lines.push(
      `期限 ${d.id}：${d.label}，${d.due}${d.overdue ? "（已到期，这一轮必须回应）" : ""}`,
    );
  }
  return lines.join("\n");
}

export function formatInput(input: TurnInput): string {
  return `【${MODE_LABELS[input.mode]}】${input.text}`;
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
    "按这个结果写这一轮的正文。同一个行动不要再给 check；失败时后果不比事先说明的更重。",
  ];
  return lines.join("\n");
}

export interface GmPrompt {
  readonly messages: readonly LlmMessage[];
  /** 本轮带上的规则模块 id，记进回合日志，上下文查看器用 */
  readonly modules: readonly string[];
}

export function buildGmPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: GmPlan,
): GmPrompt {
  const view = projectState(world, records);
  const modules = registry.activeRules(world, plan.input);
  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt(modules) }];
  for (const turn of view.turns.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: formatInput(turn.input) });
    messages.push({ role: "assistant", content: turn.text });
  }
  const parts = [`【当前状态】\n${stateSummary(view)}`];
  if (plan.kind === "resolve") parts.push(checkResultText(plan.check));
  parts.push(`【玩家】${formatInput(plan.input)}`);
  parts.push(`（先写正文，最后附 ${STATE_OPEN} 指令块。）`);
  messages.push({ role: "user", content: parts.join("\n\n") });
  return { messages, modules: modules.map((m) => m.id) };
}
