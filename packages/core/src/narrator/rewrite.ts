import type { AbortSignalLike, LlmClient, LlmMessage, LlmUsage } from "../kernel/ports";
import type { TurnRecord } from "../kernel/turnlog";
import { BASE_RULES } from "./prompts/layers";

/** 按账目改写：未定稿的一轮，账目已经结算，只把正文改得和账目一致；不重掷、不改状态 */

export const REWRITE_STAGE = `【这一步：按账目改写】
这一轮的正文已经写好，但里面有些事没能记进账目（下面列出没记上的条目和原因）。账目已经定了，不再改；你只改正文，让它和账目一致：
- 没记上的事，改成没有发生、没有得手，或者只差一点；写得自然，不解释规则，不提账目、系统这些词。
- 已经记上的变化照原文保留。
- 尽量保留原文的场面、人物、语气和篇幅；玩家写的台词照原话保留。
- 不加新的状态变化：不给东西、不花钱、不添伤，不引入新人物。

【输出】
只输出改好的正文本身：纯文本，不加标题、说明和 JSON。`;

const line = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

export function buildRewritePrompt(record: TurnRecord): LlmMessage[] {
  const input = record.input as { text?: unknown } | null;
  const said = typeof input?.text === "string" ? input.text : "";
  const missing = record.dropped.flatMap((d) => {
    const x = d as { where?: unknown; reason?: unknown; raw?: unknown } | null;
    if (typeof x?.reason !== "string") return [];
    const raw = x.raw === undefined || x.raw === null ? "" : `：${line(x.raw)}`;
    return [`- ${line(x.where)}${raw}（${x.reason}）`];
  });
  const applied = [
    ...(record.notes ?? []).map((n) => `- ${n}`),
    ...record.commands.map((c) => `- ${line(c)}`),
  ];
  const user = [
    `【玩家这一轮的输入】\n${said || "（继续）"}`,
    `【原来的正文】\n${record.text}`,
    `【对不上的原因】\n${record.unsettled ?? "关键条目没记上"}`,
    `【没记上的条目】\n${missing.length > 0 ? missing.join("\n") : "（无）"}`,
    `【已经记上的变化】\n${applied.length > 0 ? applied.join("\n") : "（无）"}`,
  ].join("\n\n");
  return [
    { role: "system", content: `${BASE_RULES}\n\n${REWRITE_STAGE}` },
    { role: "user", content: user },
  ];
}

export type RewriteResult =
  | { readonly ok: true; readonly text: string; readonly usage?: LlmUsage }
  | { readonly ok: false; readonly error: string };

/** 调叙事模型改写一轮正文；拦截、中断、空回复都报错，原来的正文保留 */
export async function rewriteNarrative(
  llm: LlmClient,
  record: TurnRecord,
  signal?: AbortSignalLike,
): Promise<RewriteResult> {
  let text = "";
  let usage: LlmUsage | undefined;
  let finished = false;
  for await (const event of llm.stream(
    { purpose: "narrator", messages: buildRewritePrompt(record), temperature: 0.3 },
    signal,
  )) {
    if (event.type === "text") text += event.text;
    else if (event.type === "blocked")
      return { ok: false, error: `模型拒绝了这次改写：${event.reason}；原来的正文保留` };
    else {
      finished = true;
      usage = event.usage;
    }
  }
  if (signal?.aborted) return { ok: false, error: "已停止改写，原来的正文保留" };
  if (!finished) return { ok: false, error: "改写没有正常结束，原来的正文保留" };
  const rewritten = text.trim();
  if (rewritten === "") return { ok: false, error: "模型没有返回正文，原来的正文保留" };
  return { ok: true, text: rewritten, ...(usage ? { usage } : {}) };
}
