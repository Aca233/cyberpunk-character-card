import { z } from "zod";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone/schema";

const EventIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "事件 id 用小写英文、数字和连字符，不能以连字符或 $ 开头");

/** 一件不可拆分的事实及其成功前提：直接内嵌同成同撤的 changes 与可选 messages，彻底消除手数下标错位。 */
export const EventPlanSchema = z.strictObject({
  id: EventIdSchema.describe("本轮唯一事件 id"),
  requires: z
    .array(z.union([z.literal("$action"), EventIdSchema]))
    .describe("成功前提：只能写前序事件 id 或 $action（本轮主行动成功）；独立事件明确写 []"),
  changes: z
    .array(z.object({ type: z.string() }))
    .describe("本事件同成同撤的状态变化指令，按发生顺序；本事件仅有来信时写 []"),
  messages: z
    .array(IncomingMessageSchema)
    .optional()
    .describe(
      `本事件触发的植入式通讯来信（本轮所有事件合计最多 ${MESSAGES_PER_TURN} 条）；无来信时省略`,
    ),
});
export type EventPlan = z.infer<typeof EventPlanSchema>;

/** 解析阶段对单个事件外壳校验：内部 changes / messages 保留 unknown，交给后续逐条 Zod 校验与批量修复。 */
const RawEventPlanSchema = z.strictObject({
  id: EventIdSchema,
  requires: z.array(z.union([z.literal("$action"), EventIdSchema])),
  changes: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
});

export interface NormalizedEventPlan {
  readonly id: string;
  readonly requires: readonly string[];
  readonly entries: readonly string[];
}

export type EventPlanResult =
  | {
      readonly ok: true;
      readonly events: NormalizedEventPlan[];
      readonly changes: unknown[];
      readonly messages: unknown[];
    }
  | { readonly ok: false; readonly error: string };

/** 校验内嵌事件图（唯一 id、有效前序依赖、非空事件），并平铺成稳定内部键 changes[i] / messages[i]。 */
export function readEventPlan(raw: unknown): EventPlanResult {
  const parsed = z.array(RawEventPlanSchema).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `events 格式不正确：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}：${issue.message}`)
        .join("；")}`,
    };
  }

  const prior = new Set<string>();
  const events: NormalizedEventPlan[] = [];
  const changes: unknown[] = [];
  const messages: unknown[] = [];

  for (const event of parsed.data) {
    if (prior.has(event.id)) return { ok: false, error: `事件 id 重复：${event.id}` };
    const required = new Set<string>();
    for (const dependency of event.requires) {
      if (required.has(dependency)) {
        return { ok: false, error: `事件 ${event.id} 重复依赖 ${dependency}` };
      }
      required.add(dependency);
      if (dependency !== "$action" && !prior.has(dependency)) {
        return { ok: false, error: `事件 ${event.id} 的依赖 ${dependency} 不是前序事件或 $action` };
      }
    }

    const eventChanges = event.changes ?? [];
    const eventMessages = event.messages ?? [];
    if (eventChanges.length === 0 && eventMessages.length === 0) {
      return {
        ok: false,
        error: `事件 ${event.id} 没有包含任何 changes 或 messages；空事件请直接删除`,
      };
    }

    const entries: string[] = [];
    for (const item of eventChanges) {
      entries.push(`changes[${changes.length}]`);
      changes.push(item);
    }
    for (const item of eventMessages) {
      entries.push(`messages[${messages.length}]`);
      messages.push(item);
    }

    events.push({ id: event.id, requires: [...event.requires], entries });
    prior.add(event.id);
  }

  return { ok: true, events, changes, messages };
}
