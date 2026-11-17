import { z } from "zod";

const EventIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "事件 id 用小写英文、数字和连字符，不能以连字符或 $ 开头");
const EntryReferenceSchema = z
  .string()
  .regex(/^(changes|messages)\[(0|[1-9]\d*)\]$/, "条目引用须精确写 changes[0] 或 messages[0]");

/** 一件不可拆分的事实及其成功前提；只负责结算归属，不替业务指令添加字段。 */
export const EventPlanSchema = z.strictObject({
  id: EventIdSchema.describe("本轮唯一事件 id"),
  requires: z
    .array(z.union([z.literal("$action"), EventIdSchema]))
    .describe("成功前提：只能写前序事件 id 或 $action（本轮主行动成功）；独立事件明确写 []"),
  entries: z
    .array(EntryReferenceSchema)
    .min(1)
    .describe("同成同撤的条目，引用 changes[i] 或 messages[i]；每条恰属一组并保持各数组原顺序"),
});
export type EventPlan = z.infer<typeof EventPlanSchema>;

export type EventPlanResult =
  | { readonly ok: true; readonly events: EventPlan[] }
  | { readonly ok: false; readonly error: string };

/** 不猜依赖、不重排事实；图不完整时由调用方保留整轮零结算草稿。 */
export function readEventPlan(
  raw: unknown,
  changeCount: number,
  messageCount: number,
): EventPlanResult {
  if (
    !Number.isSafeInteger(changeCount) ||
    changeCount < 0 ||
    !Number.isSafeInteger(messageCount) ||
    messageCount < 0
  )
    return { ok: false, error: "事件条目数量必须是非负安全整数" };
  const parsed = z.array(EventPlanSchema).safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: `events 格式不正确：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}：${issue.message}`)
        .join("；")}`,
    };

  const prior = new Set<string>();
  const assigned = new Set<string>();
  const next = { changes: 0, messages: 0 };
  const counts = { changes: changeCount, messages: messageCount };
  for (const event of parsed.data) {
    if (prior.has(event.id)) return { ok: false, error: `事件 id 重复：${event.id}` };
    const required = new Set<string>();
    for (const dependency of event.requires) {
      if (required.has(dependency))
        return { ok: false, error: `事件 ${event.id} 重复依赖 ${dependency}` };
      required.add(dependency);
      if (dependency !== "$action" && !prior.has(dependency))
        return { ok: false, error: `事件 ${event.id} 的依赖 ${dependency} 不是前序事件或 $action` };
    }
    for (const entry of event.entries) {
      if (assigned.has(entry)) return { ok: false, error: `条目 ${entry} 重复归属事件` };
      const kind = entry.startsWith("changes[") ? "changes" : "messages";
      const index = Number(entry.slice(kind.length + 1, -1));
      if (!Number.isSafeInteger(index) || index >= counts[kind])
        return { ok: false, error: `事件 ${event.id} 引用了不存在的 ${entry}` };
      if (index !== next[kind])
        return {
          ok: false,
          error: `事件 ${event.id} 的 ${entry} 打乱了原顺序或漏掉条目，应先归属 ${kind}[${next[kind]}]`,
        };
      assigned.add(entry);
      next[kind] += 1;
    }
    prior.add(event.id);
  }
  for (const kind of ["changes", "messages"] as const)
    if (next[kind] !== counts[kind])
      return { ok: false, error: `${kind}[${next[kind]}] 没有归属任何事件` };
  return { ok: true, events: parsed.data };
}
