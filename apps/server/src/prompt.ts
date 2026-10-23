import type { LlmMessage, PlayerView, TurnInput } from "@cp/core";

/**
 * 切片 3 的过渡提示词：只让主持人写正文，不出指令块。
 * 切片 4 换成常驻核心提示词加按状态挑选的规则模块
 */

/** 带最近这么多轮原文；更早的先丢，场景压缩在 M3 */
export const HISTORY_TURNS = 12;

const MODE_LABELS: Readonly<Record<TurnInput["mode"], string>> = {
  do: "做",
  say: "说",
  think: "想",
  ooc: "出戏",
};

const SYSTEM = `你是《赛博朋克 2077》世界观下文字冒险的主持人，用简体中文写作。
- 用第二人称描写玩家角色看到、听到、感到的东西，每轮 150–400 字。
- 意图优先：先理解玩家想达成什么，合理的办法直接让它发生，并写出代价。
- 不替玩家说话、做决定或描写内心；停在需要玩家回应的地方。
- 玩家输入分四种：【做】行动，【说】角色说出口的话，【想】只有角色自己知道的念头（NPC 听不到），【出戏】玩家在场外提问，用一两句话简短回答，不推进剧情。
- 不要输出指令块、JSON 或规则数值，状态由程序记账。`;

function stateSummary(view: PlayerView): string {
  const lines = [
    `时间：${view.time.text}（${view.time.periodLabel}）`,
    `地点：${view.location ?? "尚未确定，由你在开场时安排"}`,
    `生命：${view.health.hp}/${view.health.max}，${view.health.conditionLabel}`,
    `人性：${view.humanity.current}/${view.humanity.cap}，${view.humanity.stageLabel}`,
  ];
  const weapons = view.inventory.weapons.filter((w): w is string => w !== null);
  lines.push(`武器栏：${weapons.length > 0 ? weapons.join("、") : "空手"}`);
  if (view.combat.active) {
    const c = view.combat.active;
    lines.push(`战斗中：第 ${c.moment}/${c.moments} 次交锋，败局是「${c.defeat}」`);
  }
  for (const d of view.deadlines)
    lines.push(`期限：${d.label}，${d.due}${d.overdue ? "（已到期，必须回应）" : ""}`);
  return lines.join("\n");
}

export function formatInput(input: TurnInput): string {
  return `【${MODE_LABELS[input.mode]}】${input.text}`;
}

export function buildMessages(view: PlayerView, input: TurnInput): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: "system", content: `${SYSTEM}\n\n当前状态：\n${stateSummary(view)}` },
  ];
  for (const turn of view.turns.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: formatInput(turn.input) });
    messages.push({ role: "assistant", content: turn.text });
  }
  messages.push({ role: "user", content: formatInput(input) });
  return messages;
}
