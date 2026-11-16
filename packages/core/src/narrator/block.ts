import { z } from "zod";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone/schema";

/** 旧格式的指令块标签：写正文的模型偶尔仍附上，拆分器把它从正文里拿掉 */
export const STATE_OPEN = "<state>";
export const STATE_CLOSE = "</state>";

const ChoiceBaseSchema = z.object({
  text: z.string().trim().min(1).max(80).describe("用玩家的口吻写行动，不替角色说台词"),
  source: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .optional()
    .describe("专属选项的来源，例如 过往：荒坂前员工、义体：螳螂刀；只有这条路是角色独有的才写"),
});
/** 自由行动建议只记录内容与来源，不存骰点或属性门槛。 */
export const ChoiceSchema = ChoiceBaseSchema.strict();
export type Choice = z.infer<typeof ChoiceSchema>;

/** 模型提出的建议选项：零掷骰、零属性门槛，只给行动本身与特长/义体来源 */
export const ChoiceProposalSchema = ChoiceSchema;

export const MAX_CHOICES = 5;

/** ④ 抽取的整体格式，只用来生成说明；校验按条目分开做，一条不合格不连累其他条 */
export const ExtractDocSchema = z.object({
  changes: z
    .array(z.object({ type: z.string() }))
    .describe("这一轮已经发生的状态变化，按发生顺序，见下方指令；每轮都有一条 world"),
  choices: z
    .array(ChoiceProposalSchema)
    .describe(`玩家角色可能的下一步，0–3 个，最多 ${MAX_CHOICES} 个；对话正进行时通常写 []`),
  messages: z
    .array(IncomingMessageSchema)
    .optional()
    .describe(
      `消息：正文里不在场的人通过植入式通讯发来的消息，每轮最多 ${MESSAGES_PER_TURN} 条；平常不写`,
    ),
  clutch: z
    .boolean()
    .optional()
    .describe("正文停在生死瞬间时写 true：标记千钧一发的危机瞬间；只在实际发生危机时标记，不限制次数"),
  sceneEnd: z.boolean().optional().describe("一场戏收尾、换地点或跳过一段时间时写 true"),
  pin: z.boolean().optional().describe("这一轮很重要、以后要记住时写 true"),
  dropped: z
    .array(z.string())
    .describe("考虑过但没抽的，每条写上原因，例如“只是打算，没发生”；没有写 []"),
});

/** 顶层字段只看类型；choices、changes 的每一条再单独校验 */
const ExtractShapeSchema = z.object({
  choices: z.array(z.unknown()).optional().catch(undefined),
  changes: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional().catch(undefined),
  clutch: z.boolean().optional().catch(undefined),
  sceneEnd: z.boolean().optional().catch(undefined),
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
  const parsed = ExtractShapeSchema.safeParse(value);
  return parsed.success
    ? { ok: true, extract: parsed.data }
    : { ok: false, error: `changes 不是数组：${parsed.error.message}` };
}

/** Zod 报错压成一行，给修复提示词和被丢弃的指令记录用 */
export function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message))
    .join("；");
}
