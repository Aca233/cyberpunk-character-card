import type { Patch } from "immer";
import type { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage, LlmUsage, Rng } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { type CheckSpec, CheckSpecSchema, checkFactFrom } from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { registry } from "../systems/registry";
import {
  BlockDocSchema,
  type BlockShape,
  type Choice,
  ChoiceSchema,
  issueText,
  MAX_CHOICES,
  parseModelJson,
  readBlockShape,
  StateSplitter,
} from "./block";
import { schemaDoc } from "./doc";
import { prepareFor } from "./pending";
import { buildGmPrompt, type GmPlan } from "./prompts";

/**
 * 主持人的一轮：拼提示词 → 调模型（正文边收边放）→ 拆出指令块 → 逐条校验，不合格的单条修一次
 * → 业务校验和记账。只算出结果，不写日志：写日志、加锁和版本核对由调用方负责
 */

export interface Dropped {
  /** 出问题的位置，例如 changes[2]、check、choices[1]、指令块 */
  readonly where: string;
  readonly raw: unknown;
  readonly reason: string;
  /** format：格式不合格，修过一次仍不行；rules：格式对但业务校验没通过 */
  readonly stage: "format" | "rules";
}

export interface GmTurn {
  /** 正文，不含指令块 */
  readonly text: string;
  readonly read: string | undefined;
  readonly choices: readonly Choice[];
  /** 主持人提出、等玩家确认的检定 */
  readonly check: CheckSpec | undefined;
  /** 生效的指令，按结算顺序 */
  readonly commands: readonly Command[];
  readonly dropped: readonly Dropped[];
  readonly notes: readonly string[];
  readonly world: WorldState;
  readonly patches: readonly Patch[];
  readonly modules: readonly string[];
  readonly pin: boolean;
  /** 主持人判断这次是场外提问：不改状态，也不顶掉上一轮的选项和检定 */
  readonly ooc: boolean;
  readonly usage: LlmUsage | undefined;
  /** 修格式用的辅助模型调用次数和用量 */
  readonly repairs: number;
  readonly repairUsage: LlmUsage;
  /** 实际发给主持人的消息，上下文查看器和测评用 */
  readonly messages: readonly LlmMessage[];
}

export type GmResult =
  | { readonly kind: "done"; readonly turn: GmTurn }
  | { readonly kind: "blocked"; readonly reason: string };

export interface GmDeps {
  readonly llm: LlmClient;
  readonly rng: Rng;
  /** 静态数据表（content 包） */
  readonly data?: Readonly<Record<string, unknown>>;
  /** 这个存档的开场设定（内容包），故事还没开始时给模型 */
  readonly opening?: string | undefined;
  readonly signal?: AbortSignalLike;
  /** 每收到一段可以显示的正文就调用 */
  readonly onText?: (text: string) => void;
}

export class GmEmptyReplyError extends Error {
  override name = "GmEmptyReplyError";
}

export class GmAbortedError extends Error {
  override name = "GmAbortedError";
}

const REPAIR_SYSTEM =
  "你负责修复 JSON 格式。只输出修好的 JSON，不要解释，不要代码块。不改原意，不补充原文没有的内容；实在修不了就输出 null。";

const addUsage = (a: LlmUsage, b: LlmUsage | undefined): LlmUsage =>
  b
    ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }
    : a;

class TurnBuilder {
  readonly dropped: Dropped[] = [];
  readonly notes: string[] = [];
  repairs = 0;
  repairUsage: LlmUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(private readonly deps: GmDeps) {}

  checkAborted(): void {
    if (this.deps.signal?.aborted) throw new GmAbortedError("已停止生成");
  }

  drop(where: string, raw: unknown, reason: string, stage: Dropped["stage"]): void {
    this.dropped.push({ where, raw, reason, stage });
  }

  /** 让辅助模型修一次；修不好返回 undefined */
  async repair(task: string, raw: string): Promise<unknown> {
    this.checkAborted();
    this.repairs += 1;
    let text = "";
    for await (const event of this.deps.llm.stream(
      {
        purpose: "aux",
        temperature: 0,
        messages: [
          { role: "system", content: REPAIR_SYSTEM },
          { role: "user", content: `${task}\n\n原文：\n${raw}` },
        ],
      },
      this.deps.signal,
    )) {
      if (event.type === "text") text += event.text;
      else if (event.type === "blocked") return undefined;
      else this.repairUsage = addUsage(this.repairUsage, event.usage);
    }
    const parsed = parseModelJson(text);
    return parsed.ok && parsed.value !== null ? parsed.value : undefined;
  }

  /** 按 schema 校验一条，不合格时修一次，仍不合格就丢掉 */
  async validate<T>(where: string, raw: unknown, schema: z.ZodType<T>): Promise<T | undefined> {
    const first = schema.safeParse(raw);
    if (first.success) return first.data;
    const reason = issueText(first.error);
    const fixed = await this.repair(
      `这一条（${where}）不符合格式：${reason}\n应当是：${schemaDoc(schema)}`,
      JSON.stringify(raw),
    );
    if (fixed !== undefined) {
      const second = schema.safeParse(fixed);
      if (second.success) {
        this.notes.push(`${where} 的格式已自动修正`);
        return second.data;
      }
    }
    this.drop(where, raw, reason, "format");
    return undefined;
  }

  /** 拆出指令块的顶层结构；整块解析不了时修一次，仍不行就只保留正文 */
  async readBlock(block: string | null): Promise<BlockShape> {
    if (block === null) {
      this.drop("指令块", null, "回复里没有 <state> 指令块，这一轮状态不变", "format");
      return {};
    }
    const json = parseModelJson(block);
    const shape = json.ok ? readBlockShape(json.value) : undefined;
    if (shape?.ok) return shape.block;
    const reason = shape ? shape.error : json.ok ? "" : `不是合法的 JSON：${json.error}`;
    const fixed = await this.repair(
      `下面的指令块解析不了（${reason}）。修成一个 JSON 对象，格式：${schemaDoc(BlockDocSchema)}`,
      block,
    );
    const second = fixed === undefined ? undefined : readBlockShape(fixed);
    if (second?.ok) {
      this.notes.push("指令块的格式已自动修正");
      return second.block;
    }
    this.drop("指令块", block, `${reason}；修过一次仍然不行，这一轮只保留正文`, "format");
    return {};
  }
}

export async function runGmTurn(
  deps: GmDeps,
  world: WorldState,
  records: readonly LogRecord[],
  plan: GmPlan,
): Promise<GmResult> {
  const b = new TurnBuilder(deps);
  const prompt = buildGmPrompt(world, records, plan, { data: deps.data, opening: deps.opening });
  const splitter = new StateSplitter();
  let usage: LlmUsage | undefined;
  for await (const event of deps.llm.stream(
    { purpose: "gm", messages: prompt.messages },
    deps.signal,
  )) {
    if (event.type === "text") {
      const shown = splitter.push(event.text);
      if (shown !== "") deps.onText?.(shown);
    } else if (event.type === "blocked") {
      return { kind: "blocked", reason: event.reason };
    } else {
      usage = event.usage;
    }
  }
  b.checkAborted();
  const { rest, narrative, block } = splitter.finish();
  if (rest !== "") deps.onText?.(rest);
  if (narrative === "") throw new GmEmptyReplyError("模型没有返回正文，可以重试");

  const shape = await b.readBlock(block);
  // 场外提问由主持人判断（旧存档按当时选的输入方式）；写检定结果的那一轮不算
  const ooc = plan.kind === "action" && (plan.input.mode === "ooc" || shape.ooc === true);
  const oocReason = "场外提问不改状态";

  // 待确认的检定：格式对了还要能算出难度值（档位范围、属性）
  let check: CheckSpec | undefined;
  if (shape.check !== undefined && shape.check !== null) {
    if (ooc) b.drop("check", shape.check, oocReason, "rules");
    else {
      const spec = await b.validate("check", shape.check, CheckSpecSchema);
      const prepared = spec && prepareFor(world, spec);
      if (spec && prepared && !prepared.ok) b.drop("check", spec, prepared.reason, "rules");
      else check = spec;
    }
  }

  const choices: Choice[] = [];
  if (!ooc) {
    const raw = shape.choices ?? [];
    for (const [i, item] of raw.entries()) {
      const where = `choices[${i}]`;
      if (i >= MAX_CHOICES) {
        b.drop(where, item, `建议选项最多 ${MAX_CHOICES} 个`, "rules");
        continue;
      }
      const choice = await b.validate(where, item, ChoiceSchema);
      if (!choice) continue;
      const prepared = choice.check && prepareFor(world, choice.check);
      if (prepared && !prepared.ok) b.drop(where, choice, prepared.reason, "rules");
      else choices.push(choice);
    }
  }

  const commands: Command[] = [];
  for (const [i, item] of (shape.changes ?? []).entries()) {
    const where = `changes[${i}]`;
    if (ooc) {
      b.drop(where, item, oocReason, "rules");
      continue;
    }
    const type =
      typeof item === "object" && item !== null ? (item as { type?: unknown }).type : undefined;
    const schema = typeof type === "string" ? registry.commandSchema(type) : undefined;
    if (!schema) {
      b.drop(
        where,
        item,
        typeof type === "string" ? `未知的指令类型：${type}` : "指令缺少 type",
        "format",
      );
      continue;
    }
    const command = await b.validate(where, item, schema);
    if (command) commands.push(command);
  }
  b.checkAborted();

  if (!ooc && !commands.some((c) => c.type === "world")) {
    commands.push({ type: "world", activity: "talk" });
    b.notes.push("这一轮没写 world，按 talk 保底推进时间");
  }
  if (!ooc && shape.sceneEnd === true) commands.push({ type: "world.endScene" });

  const facts: Record<string, unknown> = { direct: shape.direct === true };
  if (plan.kind === "resolve") {
    facts.check = checkFactFrom(plan.check.offer.id, plan.check.prepared, plan.check.result);
  }
  const applyCtx = { rng: deps.rng, facts, ...(deps.data ? { data: deps.data } : {}) };
  const applied = registry.applyCommands(world, commands, applyCtx);
  const accepted: Command[] = [];
  for (const { command, result } of applied.results) {
    if (result.ok) {
      accepted.push(command);
      b.notes.push(...result.notes);
    } else {
      b.drop(command.type, command, result.reason, "rules");
    }
  }
  // 近期后果：按这一轮真正生效的指令归类；检定失败却什么都没发生时下一轮提醒
  const settled = ooc
    ? applied
    : registry.applyCommands(
        applied.world,
        [{ type: "fallout.record", kinds: falloutKinds(accepted, plan.kind === "resolve") }],
        applyCtx,
      );

  return {
    kind: "done",
    turn: {
      text: narrative,
      read: ooc ? undefined : shape.read,
      choices,
      check,
      commands: accepted,
      dropped: b.dropped,
      notes: b.notes,
      world: settled.world,
      patches: ooc ? applied.patches : [...applied.patches, ...settled.patches],
      modules: prompt.modules,
      pin: !ooc && shape.pin === true,
      ooc,
      usage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      messages: prompt.messages,
    },
  };
}
