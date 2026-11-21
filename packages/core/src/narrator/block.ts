import { z } from "zod";
import { SceneMemoryUpdateSchema, SceneSummaryProposalSchema } from "../systems/memory/schema";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone/schema";
import { EventPlanSchema } from "./event-plan";

/** 旧格式的指令块标签：写正文的模型偶尔仍附上，拆分器把它从正文里拿掉 */
export const STATE_OPEN = "<state>";
export const STATE_CLOSE = "</state>";

const ChoiceBaseSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("用玩家的口吻写行动或回应方向，不替角色写大段台词"),
  source: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe("专属选项的来源，例如 过往：荒坂前员工、义体：螳螂刀；只有这条路是角色独有的才写"),
});
/** 自由行动建议只记录内容与来源，不存骰点或属性门槛。 */
export const ChoiceSchema = ChoiceBaseSchema.strict();
export type Choice = z.infer<typeof ChoiceSchema>;

/** 模型提出的建议选项：零掷骰、零属性门槛，只给行动本身与特长/义体来源 */
export const ChoiceProposalSchema = ChoiceSchema;

const EMPTY_CHOICE_SOURCE = new Set(["", "无", "none", "null", "n/a"]);

/** 归一化单条建议选项：兼容纯字符串、空/null source 与多余字段，避免无害格式差异误杀选项。 */
export function normalizeChoiceProposal(raw: unknown): unknown {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text === "" ? raw : { text: text.slice(0, 120) };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const trimmedText = typeof record.text === "string" ? record.text.trim() : record.text;
  const text =
    typeof trimmedText === "string" && trimmedText.length > 120
      ? trimmedText.slice(0, 120)
      : trimmedText;
  if (typeof record.source === "string") {
    const trimmedSource = record.source.trim();
    if (!EMPTY_CHOICE_SOURCE.has(trimmedSource.toLowerCase())) {
      return { text, source: trimmedSource.slice(0, 40) };
    }
  }
  return { text };
}

export const MAX_CHOICES = 5;

/** ④ 抽取格式；事件先定归属和依赖，业务字段逐条校验，整组结算。 */
export const ExtractDocSchema = z.object({
  changes: z
    .array(z.object({ type: z.string() }))
    .describe("这一轮已经发生的状态变化，按发生顺序，见下方指令；每轮都有一条 world"),
  events: z
    .array(EventPlanSchema)
    .describe("必填事件清单；覆盖全部 changes 与 messages，依赖事件在前；没有事实条目时写 []"),
  choices: z
    .array(ChoiceProposalSchema)
    .describe(
      `玩家角色接下来可采取的 2–4 个不同方向的行动或回应，最多 ${MAX_CHOICES} 个；正常回合（含对话进行中）都应给出，仅在玩家死亡或故事结束时写 []`,
    ),
  messages: z
    .array(IncomingMessageSchema)
    .optional()
    .describe(
      `消息：正文里不在场的人通过植入式通讯发来的消息，每轮最多 ${MESSAGES_PER_TURN} 条；平常不写`,
    ),
  clutch: z
    .boolean()
    .optional()
    .describe(
      "正文停在生死瞬间时写 true：标记千钧一发的危机瞬间；只在实际发生危机时标记，不限制次数",
    ),
  sceneEnd: z.boolean().optional().describe("一场戏收尾、换地点或跳过一段时间时写 true"),
  sceneMemory: SceneMemoryUpdateSchema.describe(
    "每轮更新本场提要与锚点增量，保留事实与未兑现事项；不改写正文",
  ),
  summary: SceneSummaryProposalSchema.optional().describe(
    "收场时给整场摘要，结合此前场景记忆和本轮正文；未收场不写",
  ),
  pin: z.boolean().optional().describe("这一轮很重要、以后要记住时写 true"),
  dropped: z
    .array(z.string())
    .describe("考虑过但没抽的，每条写上原因，例如“只是打算，没发生”；没有写 []"),
});

/** 顶层字段只看类型；choices、changes 的每一条再单独校验 */
const ExtractShapeSchema = z.object({
  choices: z.array(z.unknown()).optional().catch(undefined),
  changes: z.array(z.unknown()).optional(),
  events: z.unknown().optional(),
  messages: z.array(z.unknown()).optional(),
  clutch: z.boolean().optional().catch(undefined),
  sceneEnd: z.boolean().optional().catch(undefined),
  sceneMemory: z.unknown().optional(),
  summary: z.unknown().optional(),
  pin: z.boolean().optional().catch(undefined),
  dropped: z.array(z.unknown()).optional().catch(undefined),
});
export type ExtractShape = z.infer<typeof ExtractShapeSchema>;

/**
 * 流式拆分：<state> 之前的正文边收边放，之后的内容攒起来。
 * 末尾可能是 <state> 的前半截时先扣住，下一段到了再判断
 */
export class StateSplitter {
  private pending = "";
  private shown = "";
  private block: string | null = null;

  /** 收一段模型输出，返回现在可以显示的正文 */
  push(chunk: string): string {
    if (this.block !== null) {
      this.block += chunk;
      return "";
    }
    const text = this.pending + chunk;
    const at = text.indexOf(STATE_OPEN);
    if (at >= 0) {
      this.block = text.slice(at + STATE_OPEN.length);
      this.pending = "";
      return this.show(text.slice(0, at));
    }
    const keep = partialTagLength(text);
    this.pending = text.slice(text.length - keep);
    return this.show(text.slice(0, text.length - keep));
  }

  /** 收完以后：剩下的正文、去掉首尾空白的完整正文，以及指令块原文（没有指令块时为 null） */
  finish(): { readonly rest: string; readonly narrative: string; readonly block: string | null } {
    const rest = this.block === null ? this.show(this.pending) : "";
    this.pending = "";
    const block =
      this.block === null
        ? null
        : this.block.includes(STATE_CLOSE)
          ? this.block.slice(0, this.block.indexOf(STATE_CLOSE))
          : this.block;
    return { rest, narrative: this.shown.trim(), block };
  }

  private show(text: string): string {
    this.shown += text;
    return text;
  }
}

/** text 末尾有多少个字符可能是 <state> 的开头 */
function partialTagLength(text: string): number {
  for (let n = Math.min(STATE_OPEN.length - 1, text.length); n > 0; n -= 1) {
    if (STATE_OPEN.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

export type JsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** 解析模型写的 JSON：去掉代码块围栏，取第一个 { 或 [ 到最后一个 } 或 ] */
export function parseModelJson(raw: string): JsonResult {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end < start) return { ok: false, error: "找不到 JSON" };
  try {
    return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type ShapeResult =
  | { readonly ok: true; readonly extract: ExtractShape }
  | { readonly ok: false; readonly error: string };

export function readExtractShape(value: unknown): ShapeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "抽取结果要是一个 JSON 对象" };
  }
  if (!("changes" in value) || !Array.isArray(value.changes)) {
    return { ok: false, error: "抽取必须明确给出 changes 数组；无变化写 []，不能省略" };
  }
  if (!("events" in value)) {
    return { ok: false, error: "抽取必须明确给出 events 事件清单；无事实条目写 []，不能猜测依赖" };
  }
  const parsed = ExtractShapeSchema.safeParse(value);
  return parsed.success
    ? { ok: true, extract: parsed.data }
    : { ok: false, error: `抽取字段格式不正确：${issueText(parsed.error)}` };
}

/** Zod 报错压成一行，给修复提示词和被丢弃的指令记录用 */
export function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message))
    .join("；");
}
