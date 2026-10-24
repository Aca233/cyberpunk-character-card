import { z } from "zod";
import { AttributeSchema, CheckSpecSchema } from "../systems/dice/schema";

/** 模型回复的格式：正文在前，末尾一个 <state> 指令块，块内是一个 JSON 对象 */
export const STATE_OPEN = "<state>";
export const STATE_CLOSE = "</state>";

/** 门槛：属性达标直接成功，不掷骰 */
export const GateSchema = z.object({
  attribute: AttributeSchema,
  value: z.number().int().min(1).max(20),
});
export type Gate = z.infer<typeof GateSchema>;

export const ChoiceSchema = z
  .object({
    text: z.string().trim().min(1).max(80).describe("用玩家的口吻写行动，不替角色说台词"),
    gate: GateSchema.optional().describe("门槛判定，属性达标直接成功"),
    check: CheckSpecSchema.optional().describe("风险掷骰，选中就直接掷"),
    source: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .optional()
      .describe("专属选项的来源，例如 过往：荒坂前员工、义体：螳螂刀；只有这条路是角色独有的才写"),
  })
  .refine((c) => !(c.gate && c.check), "一个选项只能有 gate 或 check 之一");
export type Choice = z.infer<typeof ChoiceSchema>;

export const MAX_CHOICES = 5;

/** 内心声音：过往和出身、义体、人性、武器栏里的不朽武器四种来源 */
export const VoiceSchema = z.object({
  from: z
    .enum(["past", "chrome", "humanity", "iconic"])
    .describe("past 过往和出身，chrome 义体，humanity 人性，iconic 武器栏里的不朽武器"),
  text: z.string().trim().min(1).max(60).describe("一句脑子里冒出来的念头"),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const MAX_VOICES = 2;

/** 存档里的内心声音按 schema 读，格式不对的跳过 */
export function readVoices(raw: readonly unknown[] | undefined): Voice[] {
  return (raw ?? []).flatMap((v) => {
    const parsed = VoiceSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

/** 指令块的整体格式，只用来生成说明；校验按条目分开做，一条不合格不连累其他条 */
export const BlockDocSchema = z.object({
  read: z.string().optional().describe("一句话说出你对玩家意图的理解"),
  choices: z
    .array(ChoiceSchema)
    .describe(`玩家角色可能的下一步，0–3 个，最多 ${MAX_CHOICES} 个；对话正进行时通常写 []`),
  check: CheckSpecSchema.nullable().describe(
    "需要掷骰时给出，这一轮只写到行动将要发生；不需要时写 null",
  ),
  changes: z
    .array(z.object({ type: z.string() }))
    .describe("本轮的状态变化，按发生顺序，见下方指令"),
  voices: z
    .array(VoiceSchema)
    .optional()
    .describe(`内心声音，只在关键时刻写，最多 ${MAX_VOICES} 条；平常不写`),
  direct: z.boolean().optional().describe("这一轮的主行动没掷骰、直接成功时写 true"),
  sceneEnd: z.boolean().optional().describe("一场戏收尾、换地点或跳过一段时间时写 true"),
  pin: z.boolean().optional().describe("这一轮很重要、以后要记住时写 true"),
  ooc: z
    .boolean()
    .optional()
    .describe("玩家跳出角色在场外提问（问规则、问可行性、问现状），不是让角色行动时写 true"),
});

/** 顶层字段只看类型；choices、check、changes 的每一条再单独校验 */
const BlockShapeSchema = z.object({
  read: z.string().optional().catch(undefined),
  choices: z.array(z.unknown()).optional().catch(undefined),
  check: z.unknown().optional(),
  changes: z.array(z.unknown()).optional(),
  voices: z.array(z.unknown()).optional().catch(undefined),
  direct: z.boolean().optional().catch(undefined),
  sceneEnd: z.boolean().optional().catch(undefined),
  pin: z.boolean().optional().catch(undefined),
  ooc: z.boolean().optional().catch(undefined),
});
export type BlockShape = z.infer<typeof BlockShapeSchema>;

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
  | { readonly ok: true; readonly block: BlockShape }
  | { readonly ok: false; readonly error: string };

export function readBlockShape(value: unknown): ShapeResult {
  const parsed = BlockShapeSchema.safeParse(value);
  return parsed.success
    ? { ok: true, block: parsed.data }
    : { ok: false, error: `指令块不是对象，或 changes 不是数组：${parsed.error.message}` };
}

/** Zod 报错压成一行，给修复提示词和被丢弃的指令记录用 */
export function issueText(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message))
    .join("；");
}
