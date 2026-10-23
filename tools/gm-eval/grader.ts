import {
  checkResultText,
  formatInput,
  type GmPlan,
  type GmTurn,
  type LlmClient,
  type LlmUsage,
  parseModelJson,
  projectState,
  stateSummary,
} from "@cp/core";
import { z } from "zod";
import type { EvalCase, Scenario } from "./case";

/** 评分模型：按用例的评分表给主观项打 1–5 分，各附一句理由 */

export interface Score {
  readonly item: string;
  readonly score: number;
  readonly reason: string;
}

export type GradeResult =
  | { readonly ok: true; readonly scores: readonly Score[]; readonly usage: LlmUsage | undefined }
  | { readonly ok: false; readonly error: string; readonly usage: LlmUsage | undefined };

const GRADER_SYSTEM = `你是文字冒险游戏的测评员，评的是角色模型这一轮的回复。游戏是《赛博朋克 2077》世界观下的角色扮演：玩家扮演自己的角色，只有一个输入框；模型扮演 NPC 和城市本身，写正文并在末尾给出指令块。
按评分表逐条打 1–5 分：5 完全做到，4 基本做到、有小瑕疵，3 一半一半，2 明显没做到，1 完全相反。每条附一句理由，指出正文里的具体位置。
只看评分表上的项目，不评文笔好坏以外的东西，也不因为篇幅长短加减分，除非评分表这样要求。
只输出一个 JSON 对象，不要代码块：{"scores": [{"item": "评分表原文", "score": 1到5的整数, "reason": "一句话"}]}`;

const ReplySchema = z.object({
  scores: z.array(
    z.object({
      item: z.string(),
      score: z.number().int().min(1).max(5),
      reason: z.string(),
    }),
  ),
});

function blockSummary(turn: GmTurn): string {
  return JSON.stringify({
    read: turn.read,
    choices: turn.choices,
    check: turn.check ?? null,
    changes: turn.commands,
  });
}

export function graderPrompt(c: EvalCase, scenario: Scenario, plan: GmPlan, turn: GmTurn): string {
  const view = projectState(scenario.world, scenario.records);
  const history = view.turns
    .slice(-3)
    .map((t) => `${formatInput(t.input)}\n模型：${t.text}`)
    .join("\n\n");
  return [
    `【用例】${c.title}`,
    `【当前状态】\n${stateSummary(view)}`,
    ...(history ? [`【前几轮】\n${history}`] : []),
    ...(plan.kind === "resolve" ? [checkResultText(plan.check)] : []),
    `【这一轮玩家】${formatInput(plan.input)}`,
    `【模型正文】\n${turn.text}`,
    `【模型指令块（已校验）】\n${blockSummary(turn)}`,
    `【评分表】\n${c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
  ].join("\n\n");
}

export async function grade(
  llm: LlmClient,
  c: EvalCase,
  scenario: Scenario,
  plan: GmPlan,
  turn: GmTurn,
): Promise<GradeResult> {
  let text = "";
  let usage: LlmUsage | undefined;
  for await (const event of llm.stream({
    purpose: "gm",
    temperature: 0,
    messages: [
      { role: "system", content: GRADER_SYSTEM },
      { role: "user", content: graderPrompt(c, scenario, plan, turn) },
    ],
  })) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked")
      return { ok: false, error: `评分模型拒答：${event.reason}`, usage };
    else usage = event.usage;
  }
  const json = parseModelJson(text);
  const parsed = json.ok ? ReplySchema.safeParse(json.value) : undefined;
  if (!parsed?.success) return { ok: false, error: "评分模型的回复解析不了", usage };
  if (parsed.data.scores.length !== c.rubric.length) {
    return {
      ok: false,
      error: `评分表有 ${c.rubric.length} 项，评分模型给了 ${parsed.data.scores.length} 项`,
      usage,
    };
  }
  // 按顺序对应评分表，不信任模型抄回来的条目原文
  const scores = parsed.data.scores.map((s, i) => ({ ...s, item: c.rubric[i] as string }));
  return { ok: true, scores, usage };
}
