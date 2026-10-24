import type { Patch } from "immer";
import type { z } from "zod";
import type { AbortSignalLike, LlmClient, LlmMessage, LlmUsage, Rng } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { Closeup, LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import {
  CharacterStateSchema,
  TRAIT_LABELS,
  type Trait,
  type TraitSlot,
} from "../systems/character";
import { CombatStateSchema, MAX_QUICK } from "../systems/combat";
import { CyberwareStateSchema, cyberwareCatalog } from "../systems/cyberware";
import { type CheckSpec, CheckSpecSchema, checkFactFrom } from "../systems/dice";
import { falloutKinds } from "../systems/fallout";
import { HealthStateSchema } from "../systems/health";
import { itemCatalog } from "../systems/inventory/apply";
import { InventoryStateSchema, type ItemDef } from "../systems/inventory/schema";
import { IncomingMessageSchema, MESSAGES_PER_TURN } from "../systems/phone";
import { registry } from "../systems/registry";
import { WorldClockStateSchema } from "../systems/world";
import {
  BlockDocSchema,
  type BlockShape,
  type Choice,
  ChoiceSchema,
  issueText,
  MAX_CHOICES,
  MAX_VOICES,
  parseModelJson,
  readBlockShape,
  StateSplitter,
  type Voice,
  VoiceSchema,
} from "./block";
import { schemaDoc } from "./doc";
import { prepareFor } from "./pending";
import { buildGmPrompt, type GmPlan } from "./prompts";
import { closeupFor, sceneTitle } from "./scene";

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
  /** 内心声音，0–2 条 */
  readonly voices: readonly Voice[];
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
  /** 生死瞬间：下一轮可以开斯安威斯坦 */
  readonly clutch: boolean;
  /** 这一轮发生在第几个场景 */
  readonly scene: number;
  /** 场景标题卡的一行；还没有地点时为 undefined */
  readonly title: string | undefined;
  /** 这一轮弹出的特写卡 */
  readonly closeup: Closeup | undefined;
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

/** 来源前缀能对上主板上的哪几类；过往也算上负面经历 */
const SOURCE_SLOTS: Readonly<Record<string, readonly TraitSlot[]>> = {
  出身: ["origin"],
  过往: ["past", "flaw"],
  本事: ["skill"],
  负面经历: ["flaw"],
  联动: ["combo"],
};

/**
 * 专属选项的来源要对得上：义体来源必须是身上装着的义体；角色有主板时，出身、过往、本事、
 * 联动来源必须是主板上的模块（名字互相包含就算）。对不上时去掉来源，选项留着
 */
function verifySource(
  choice: Choice,
  chrome: ReadonlySet<string>,
  traits: readonly Trait[],
  notes: string[],
): Choice {
  const match = choice.source?.match(/^([^：:]+)[：:]\s*(.+)$/);
  if (!match) return choice;
  const kind = (match[1] ?? "").trim();
  const named = (match[2] ?? "").trim();
  let reason: string;
  if (kind === "义体") {
    if (chrome.has(named)) return choice;
    reason = "不是身上装着的义体";
  } else {
    const slots = SOURCE_SLOTS[kind];
    if (slots === undefined || traits.length === 0) return choice;
    const fits = traits.some(
      (t) => slots.includes(t.slot) && (t.label.includes(named) || named.includes(t.label)),
    );
    if (fits) return choice;
    reason = `不是主板上的${slots.map((s) => TRAIT_LABELS[s]).join("或")}`;
  }
  const { source: _source, ...rest } = choice;
  notes.push(`选项「${choice.text}」的来源「${choice.source}」${reason}，去掉了来源`);
  return rest;
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
  // 闪回里不掷骰、不推进时间、不记账：只认 flashback 指令
  const inFlashback = CharacterStateSchema.parse(world.slices.character).flashback !== null;
  const flashbackReason = "闪回里不掷骰、不推进时间、不记账";

  // 待确认的检定：格式对了还要能算出难度值（档位范围、属性）
  let check: CheckSpec | undefined;
  if (shape.check !== undefined && shape.check !== null) {
    if (ooc || inFlashback) {
      b.drop("check", shape.check, ooc ? oocReason : flashbackReason, "rules");
    } else {
      const spec = await b.validate("check", shape.check, CheckSpecSchema);
      const prepared = spec && prepareFor(world, spec);
      if (spec && prepared && !prepared.ok) b.drop("check", spec, prepared.reason, "rules");
      else check = spec;
    }
  }

  // 装着的义体的名字：义体来源的专属选项和义体的内心声音要对得上
  const parts = cyberwareCatalog(deps.data ?? {});
  // 打坏的义体修好前失去能力：不算专属选项的来源、不会说话、不挡伤害
  const installedChrome = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).installed;
  const broken = new Set(HealthStateSchema.parse(world.slices.health).brokenChrome);
  const working = installedChrome.filter((c) => !broken.has(c.id));
  const chrome = new Set(working.map((c) => parts.get(c.id)?.name ?? c.id));
  const traits = CharacterStateSchema.parse(world.slices.character).traits;
  // 武器栏里有带专属声音的不朽武器时，它才会说话
  const items = deps.data?.items ? itemCatalog(deps.data) : new Map<string, ItemDef>();
  const inventory = InventoryStateSchema.safeParse(world.slices.inventory);
  const iconicHeld =
    inventory.success &&
    inventory.data.weapons.some((w) => w !== null && items.get(w)?.voice !== undefined);
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
      // 闪回里不掷骰：选项去掉检定，只留行动
      if (inFlashback && choice.check) {
        const { check: _dropped, ...plain } = choice;
        b.notes.push(`选项「${choice.text}」在闪回里，去掉了检定`);
        choices.push(verifySource(plain as Choice, chrome, traits, b.notes));
        continue;
      }
      const prepared = choice.check && prepareFor(world, choice.check);
      if (prepared && !prepared.ok) b.drop(where, choice, prepared.reason, "rules");
      else choices.push(verifySource(choice, chrome, traits, b.notes));
    }
  }

  const voices: Voice[] = [];
  if (!ooc) {
    for (const [i, item] of (shape.voices ?? []).entries()) {
      const where = `voices[${i}]`;
      if (i >= MAX_VOICES) {
        b.drop(where, item, `内心声音每轮最多 ${MAX_VOICES} 条`, "rules");
        continue;
      }
      const voice = await b.validate(where, item, VoiceSchema);
      if (!voice) continue;
      if (voice.from === "chrome" && chrome.size === 0) {
        b.drop(where, voice, "身上没装义体，义体不会说话", "rules");
        continue;
      }
      if (voice.from === "iconic" && !iconicHeld) {
        b.drop(where, voice, "武器栏里没有会说话的不朽武器", "rules");
        continue;
      }
      voices.push(voice);
    }
  }

  const commands: Command[] = [];
  // 快捷动作（用治疗品、扔手雷）每次交锋最多两个：超出的在结算前拦下
  const fight = CombatStateSchema.parse(world.slices.combat).active;
  let quick = fight ? (fight.quick ?? 0) : 0;
  const isQuick = (c: Command) => {
    const x = c as { type: string; source?: unknown; action?: unknown; id?: unknown };
    if (x.type === "heal") return x.source === "maxdoc";
    return x.type === "item" && x.action === "use" && typeof x.id === "string"
      ? items.get(x.id)?.kind === "grenade"
      : false;
  };
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
    if (!command) continue;
    if (inFlashback && command.type !== "flashback") {
      b.drop(where, command, flashbackReason, "rules");
      continue;
    }
    if (
      fight &&
      command.type === "flashback" &&
      (command as { action?: unknown }).action !== "end"
    ) {
      b.drop(where, command, "战斗中不能闪回", "rules");
      continue;
    }
    if (fight && isQuick(command)) {
      if (quick >= MAX_QUICK) {
        b.drop(where, command, `这次交锋的快捷动作已经用了 ${MAX_QUICK} 个`, "rules");
        continue;
      }
      quick += 1;
    }
    commands.push(command);
  }
  b.checkAborted();

  // 消息：每轮最多两条；场外提问和闪回里不收
  for (const [i, item] of (shape.messages ?? []).entries()) {
    const where = `messages[${i}]`;
    if (ooc || inFlashback) {
      b.drop(where, item, ooc ? oocReason : flashbackReason, "rules");
      continue;
    }
    if (i >= MESSAGES_PER_TURN) {
      b.drop(where, item, `消息每轮最多 ${MESSAGES_PER_TURN} 条`, "rules");
      continue;
    }
    const message = await b.validate(where, item, IncomingMessageSchema);
    if (message) commands.push({ type: "phone.receive", from: message.from, text: message.text });
  }

  // 对峙倒数：这一轮开始前就在对峙才扣，这一轮刚开的不扣；化解或开打了倒数什么也不做
  if (!ooc && !inFlashback && CombatStateSchema.parse(world.slices.combat).standoff) {
    commands.push({ type: "combat.standoffTick" });
  }
  const flashbackAction = (c: Command) =>
    c.type === "flashback" ? (c as { action?: unknown }).action : undefined;
  // 闪回里过一轮；这一轮写了 end 就不再扣
  if (!ooc && inFlashback && !commands.some((c) => flashbackAction(c) === "end")) {
    commands.push({ type: "character.flashbackTick" });
  }
  // 闪回里和开闪回的这一轮不按 talk 保底推进时间
  const startsFlashback = commands.some((c) => flashbackAction(c) === "start");
  if (!ooc && !inFlashback && !startsFlashback && !commands.some((c) => c.type === "world")) {
    commands.push({ type: "world", activity: "talk" });
    b.notes.push("这一轮没写 world，按 talk 保底推进时间");
  }
  if (!ooc && shape.sceneEnd === true) {
    if (inFlashback) b.notes.push("闪回里不收场，回到现在后再写 sceneEnd");
    else commands.push({ type: "world.endScene" });
  }

  const facts: Record<string, unknown> = { direct: shape.direct === true };
  if (plan.kind === "resolve") {
    facts.check = checkFactFrom(plan.check.offer.id, plan.check.prepared, plan.check.result);
  }
  // 护甲降档：health 不能读义体（health→cyberware→character→health 会成环），这里把护甲义体的名字放进事实
  const armor = working.map((c) => parts.get(c.id)).find((d) => d?.armor === true);
  if (armor) facts.armor = armor.name;
  // 断肢打在义肢上改记为义体损坏：坏着的也要放进来，不然会当成血肉再断一次
  const limbChrome = Object.fromEntries(
    installedChrome
      .filter((c) => c.slot === "arms" || c.slot === "legs")
      .map((c) => [c.slot, { id: c.id, name: parts.get(c.id)?.name ?? c.id }]),
  );
  if (Object.keys(limbChrome).length > 0) facts.chrome = limbChrome;
  // 开了斯安威斯坦：先扣人性再结算；能不能开（clutch、义体能用）由后端在调模型前拦下
  if (plan.kind === "action" && plan.input.sandevistan === true && !ooc && !inFlashback) {
    const boost = working.map((c) => parts.get(c.id)).find((d) => d?.accelerator === true);
    if (boost) commands.unshift({ type: "cyberware.boost", id: boost.id });
  }
  // 回复消息：先记下回的是哪一条
  if (plan.kind === "action" && plan.input.replyTo !== undefined && !ooc) {
    commands.unshift({ type: "phone.reply", id: plan.input.replyTo });
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
  const settled =
    ooc || inFlashback
      ? applied
      : registry.applyCommands(
          applied.world,
          [{ type: "fallout.record", kinds: falloutKinds(accepted, plan.kind === "resolve") }],
          applyCtx,
        );

  // 场景标题：这一轮收了场就按收场前的地点和时间
  const before = WorldClockStateSchema.parse(world.slices.world);
  const after = WorldClockStateSchema.parse(settled.world.slices.world);
  const title = sceneTitle(after.scene === before.scene ? settled.world : world, deps.data ?? {});
  const closeup = ooc ? undefined : closeupFor(accepted, world, records, deps.data ?? {});

  return {
    kind: "done",
    turn: {
      text: narrative,
      read: ooc ? undefined : shape.read,
      choices,
      voices,
      check,
      commands: accepted,
      dropped: b.dropped,
      notes: b.notes,
      world: settled.world,
      patches: ooc ? applied.patches : [...applied.patches, ...settled.patches],
      modules: prompt.modules,
      pin: !ooc && shape.pin === true,
      clutch: !ooc && shape.clutch === true,
      scene: before.scene,
      title,
      closeup,
      ooc,
      usage,
      repairs: b.repairs,
      repairUsage: b.repairUsage,
      messages: prompt.messages,
    },
  };
}
