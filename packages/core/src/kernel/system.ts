import { current, type Draft, enablePatches, isDraft, type Patch, produceWithPatches } from "immer";
import type { z } from "zod";
import type { Rng } from "./ports";
import type { LogRecord } from "./turnlog";
import type { WorldState } from "./world";

enablePatches();

/** 指令是开放的数据：除了 type，其余字段由负责它的系统用 schema 校验 */
export interface Command {
  readonly type: string;
  readonly [field: string]: unknown;
}

export type ApplyOutcome =
  | {
      readonly ok: true;
      /** 给玩家看的说明，例如“人性 −20 已截断为 −15” */
      readonly notes?: readonly string[];
      /** 交给 dependsOn 里的系统结算的指令；其中任何一条失败，整条指令都不生效 */
      readonly emit?: readonly Command[];
      /** 广播给所有系统的信号，例如 scene.end */
      readonly signals?: readonly string[];
      /** 把游戏时间推进到这一分钟，并运行各系统的 tick */
      readonly advanceTo?: number;
    }
  | { readonly ok: false; readonly reason: string };

/** 调用方（回合流程、建档、测试）提供的结算环境 */
export interface ApplyContext {
  readonly rng: Rng;
  /** 本轮的事实，例如检定结果；各系统用自己的 schema 读取，不信任未校验的内容 */
  readonly facts?: Readonly<Record<string, unknown>>;
  /** 静态数据表（content 包），例如 items；各系统用自己的 schema 读取 */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** 系统结算时看到的环境 */
export interface SystemContext {
  readonly rng: Rng;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly data: Readonly<Record<string, unknown>>;
  /** 当前游戏时间（分钟） */
  readonly now: number;
  /** 读取 dependsOn 里声明过的系统的状态，返回只读快照 */
  read<T>(systemId: string): T;
}

export interface TimeSpan {
  readonly from: number;
  readonly to: number;
}

/** 判断规则模块带不带时看的玩家输入 */
export interface RuleInput {
  /** 只有旧存档带输入方式；新输入不写 */
  readonly mode?: string | undefined;
  readonly text: string;
}

/** 规则模块：叙事模型提示词里的一段规则，代码每轮按状态决定带不带 */
export interface RuleModule<S = unknown> {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** 判断用的一半：什么时候检定、档位怎么选；没写时判断拿 text */
  readonly judge?: string;
  /** 写正文用的一半：常见的转折、对手会怎么做、什么后果合适；没写时写正文拿 text */
  readonly narrate?: string;
  /** 这一段负责说明的指令类型；格式说明由这些指令的 schema 生成 */
  readonly commands?: readonly string[];
  /** 这一轮要不要带上；判断不准时宁可多带 */
  when(state: S, input: RuleInput): boolean;
}

type CommandSchemas<C extends Command> = {
  readonly [K in C["type"]]: z.ZodType<Extract<C, { type: K }>>;
};

/**
 * 模型提议的格式和结算用的指令不一样时（模型选档位、代码换成数字）：
 * schema 只用来给模型写格式说明和校验，校验后输出结算用的指令；
 * legacy 把模型仍按旧格式写的数字换成档位，返回换过的对象和一句提示，不认得时返回 undefined
 */
export interface CommandProposal<C extends Command = Command> {
  readonly schema: z.ZodType<C>;
  legacy?(
    raw: Readonly<Record<string, unknown>>,
  ): { readonly value: Record<string, unknown>; readonly note: string } | undefined;
}

type CommandProposals<C extends Command> = {
  readonly [K in C["type"]]?: CommandProposal<Extract<C, { type: K }>>;
};

export interface SystemDef<S, C extends Command, I extends Command = never> {
  readonly id: string;
  /** 可以读取状态、发出指令的其他系统；同时决定结算顺序 */
  readonly dependsOn?: readonly string[];
  readonly state: z.ZodType<S>;
  initial(): S;
  /** 模型可以使用的指令，键必须等于指令的 type */
  readonly commands: CommandSchemas<C>;
  /** 只能由代码发出的指令：建档、回合流程，或依赖这个系统的其他系统 */
  readonly internal?: CommandSchemas<I>;
  /** 模型提议的格式，只给 commands 里的指令写；没写的指令模型直接写结算格式 */
  readonly proposals?: CommandProposals<C>;
  /** 在草稿上结算一条指令；返回 ok: false 时这条指令整体不生效 */
  apply(draft: Draft<S>, command: C | I, ctx: SystemContext): ApplyOutcome;
  /** 信号处理：只改自己的状态，不能失败 */
  readonly on?: Readonly<Record<string, (draft: Draft<S>, ctx: SystemContext) => void>>;
  /** 时间推进时的结算，例如重伤失血、期限到期；不能失败 */
  tick?(draft: Draft<S>, span: TimeSpan, ctx: SystemContext): void;
  /** 这个系统给叙事模型的规则模块 */
  readonly rules?: readonly RuleModule<S>[];
  /** 这个系统交给玩家投影的一块；诉求、底线、秘密、隐藏转折这类只给模型看的东西不能放进来 */
  readonly view?: SystemView;
  /** 玩家在界面上直接做的操作：键等于操作的 type，同一个 type 只能由一个系统交 */
  readonly actions?: Readonly<Record<string, PlayerActionDef>>;
  /** 给叙事模型的情境节，按 order 排进【当前状态】之后；只有这里可以写答案、真相这类隐藏信息 */
  readonly sections?: readonly SystemSection[];
  /** 这个系统交给玩家的待办：只能用玩家已经知道的东西，委托转折、心事走向这类不能放进来 */
  objectives?(ctx: ViewContext): readonly Objective[];
  /** 这个系统交给玩家的威胁：只写玩家已经知道的，宿敌没扫描或打听到的准备不能放进来 */
  threats?(ctx: ViewContext): readonly Threat[];
}

/** 待办的状态：offered 挂着等接，active 在办，overdue 过了期限还没了结 */
export type ObjectiveStatus = "offered" | "active" | "overdue";

/** 一条待办，格式各系统统一：右侧追踪和日志页照这个显示，不用知道是哪个系统交的 */
export interface Objective {
  /** 在所有待办里唯一，写成「来源:原 id」 */
  readonly id: string;
  /** 交这条待办的系统 id */
  readonly source: string;
  /** 来源的中文名，例如「委托」「NCPD 警情」 */
  readonly sourceLabel: string;
  readonly title: string;
  /** 地点 id 或中文地名；不在某个地方办的是 null */
  readonly location: string | null;
  /** 期限的游戏时间写法；没有期限是 null */
  readonly due: string | null;
  /** 离期限还有多少分钟，已过期为负；没有期限是 null */
  readonly dueIn: number | null;
  /** 一句进度，例如「第 2/3 层」；没有是 null */
  readonly progress: string | null;
  readonly status: ObjectiveStatus;
}

/** 一条威胁：谁盯上了你、多严重、为什么 */
export interface Threat {
  /** 在所有威胁里唯一，写成「来源:原 id」 */
  readonly id: string;
  readonly source: string;
  readonly sourceLabel: string;
  /** 对方是谁，例如「NCPD」「漩涡帮」或宿敌的名字 */
  readonly who: string;
  /** 0–5，0 是还没动手的留意，5 是正在追杀 */
  readonly level: number;
  readonly reason: string;
}

/** 拼情境时系统看到的环境：只读；data 没给时为 undefined，input 是这一轮玩家的输入 */
export interface SectionContext {
  readonly world: WorldState;
  readonly data: Readonly<Record<string, unknown>> | undefined;
  readonly input: { readonly text: string; readonly braindance?: string | undefined };
}

/** 一节情境：拼成「【title】」加正文；render 返回 undefined 时这一轮不带这一节 */
export interface SystemSection {
  readonly order: number;
  readonly title: string;
  render(ctx: SectionContext): string | undefined;
}

/** 投影时系统看到的环境：只读，不能改状态 */
export interface ViewContext {
  readonly world: WorldState;
  readonly records: readonly LogRecord[];
  /** 静态数据表（content 包）；带物品表和地点表时给出中文名 */
  readonly data: Readonly<Record<string, unknown>>;
}

/** 玩家投影里的一块：key 是投影里的字段名，同一个 key 只能由一个系统交 */
export interface SystemView {
  readonly key: string;
  project(ctx: ViewContext): unknown;
}

/** 界面操作翻成指令时看到的环境：整个世界的只读快照，操作的前提可能要看别的系统 */
export interface ActionContext {
  readonly world: WorldState;
  readonly data: Readonly<Record<string, unknown>>;
}

/** 一种界面操作：schema 校验请求；commands 翻成内部指令，返回字符串表示操作不成立 */
// biome-ignore lint/suspicious/noExplicitAny: 注册表要存放请求格式各不相同的操作
export interface PlayerActionDef<A extends { readonly type: string } = any> {
  readonly schema: z.ZodType<A>;
  commands(action: A, ctx: ActionContext): Command[] | string;
}

/** 给系统定义一种界面操作时用，保留请求的类型 */
export function defineAction<A extends { readonly type: string }>(
  def: PlayerActionDef<A>,
): PlayerActionDef<A> {
  return def;
}

// biome-ignore lint/suspicious/noExplicitAny: 注册表要存放状态和指令类型各不相同的系统
export type AnySystem = SystemDef<any, any, any>;

export function defineSystem<S, C extends Command, I extends Command = never>(
  def: SystemDef<S, C, I>,
): SystemDef<S, C, I> {
  return def;
}

export class RegistryError extends Error {
  override name = "RegistryError";
}

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: string };

export type CommandResult =
  | { readonly ok: true; readonly notes: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export interface AppliedCommand {
  readonly command: Command;
  readonly result: CommandResult;
}

export interface WorldChange {
  readonly world: WorldState;
  readonly patches: readonly Patch[];
}

export interface ApplyBatchResult extends WorldChange {
  readonly results: readonly AppliedCommand[];
}

export interface Registry {
  /** 按 dependsOn 拓扑排序后的系统，被依赖的在前 */
  readonly order: readonly AnySystem[];
  initialWorld(time: number): WorldState;
  /** 模型可以使用的指令类型 */
  commandTypes(): readonly string[];
  /** 模型可以使用的指令的 schema，用来生成格式说明和单条修复 */
  commandSchema(type: string): z.ZodType<Command> | undefined;
  /** 模型仍按旧的数字格式写时换成档位；不用换时原样返回，note 为 undefined */
  normalizeProposal(raw: unknown): { readonly value: unknown; readonly note: string | undefined };
  /** 所有规则模块，按系统顺序排好；顺序固定，状态不变时提示词前缀不变 */
  readonly rules: readonly RuleModule[];
  /** 这一轮要带的规则模块 */
  activeRules(world: WorldState, input: RuleInput): readonly RuleModule[];
  /** 校验模型给出的指令，只接受模型可以使用的类型 */
  parseCommand(raw: unknown): ParseResult;
  /** 校验代码发出的指令，内部指令也接受 */
  parseInternal(raw: unknown): ParseResult;
  /** 逐条结算；每条指令连同它引起的连锁结算一起生效或一起丢弃 */
  applyCommands(
    world: WorldState,
    commands: readonly Command[],
    ctx: ApplyContext,
  ): ApplyBatchResult;
  /** 由回合流程发出的信号，例如 turn.end */
  signal(world: WorldState, signal: string, ctx: ApplyContext): WorldChange;
  /** 把游戏时间推进到 to；倒退时报错 */
  advanceTo(world: WorldState, to: number, ctx: ApplyContext): WorldChange;
  /** 交了 view 的系统的字段名，按系统顺序 */
  readonly viewKeys: readonly string[];
  /** 按系统顺序调用各系统的 view，返回 字段名 → 投影；只读，不改状态 */
  project(ctx: ViewContext): Readonly<Record<string, unknown>>;
  /** 已注册的界面操作类型 */
  actionTypes(): readonly string[];
  /** 界面操作的请求 schema；不包含叙事模型指令或内部指令 */
  actionSchema(type: string): z.ZodType<{ readonly type: string }> | undefined;
  /** 查表校验并翻成内部指令；返回字符串表示拒绝，只读，不结算 */
  actionCommands(raw: unknown, ctx: ActionContext): Command[] | string;
  /** 各系统交的情境节按 order 排好、拼成「【标题】\n正文」；没内容的节跳过，只读 */
  sections(ctx: SectionContext): readonly string[];
  /** 各系统交的待办，按系统顺序拼起来；id 重复时报错，只读 */
  objectives(ctx: ViewContext): readonly Objective[];
  /** 各系统交的威胁，按系统顺序拼起来；id 重复或等级不在 0–5 时报错，只读 */
  threats(ctx: ViewContext): readonly Threat[];
}

interface Owner {
  readonly system: AnySystem;
  readonly schema: z.ZodType<Command>;
  readonly internal: boolean;
  readonly proposal: CommandProposal | undefined;
}

const MAX_CHAIN = 8;

export function createRegistry(systems: readonly AnySystem[]): Registry {
  const order = sortByDependencies(systems);
  const views = new Map<string, { readonly systemId: string; readonly view: SystemView }>();
  for (const system of order) {
    const view = system.view;
    if (!view) continue;
    const existing = views.get(view.key);
    if (existing) {
      throw new RegistryError(
        `投影字段 ${view.key} 同时由 ${existing.systemId} 和 ${system.id} 注册`,
      );
    }
    views.set(view.key, { systemId: system.id, view });
  }
  const actions = new Map<string, { readonly systemId: string; readonly def: PlayerActionDef }>();
  for (const system of order) {
    for (const [type, def] of Object.entries(system.actions ?? {})) {
      const existing = actions.get(type);
      if (existing) {
        throw new RegistryError(
          `界面操作 ${type} 同时由 ${existing.systemId} 和 ${system.id} 注册`,
        );
      }
      actions.set(type, { systemId: system.id, def });
    }
  }
  const sectionList: { readonly systemId: string; readonly section: SystemSection }[] = [];
  for (const system of order) {
    for (const section of system.sections ?? []) {
      const existing = sectionList.find((s) => s.section.order === section.order);
      if (existing) {
        throw new RegistryError(
          `情境节排序 ${section.order} 同时由 ${existing.systemId}（${existing.section.title}）和 ${system.id}（${section.title}）使用`,
        );
      }
      sectionList.push({ systemId: system.id, section });
    }
  }
  sectionList.sort((a, b) => a.section.order - b.section.order);
  const owners = new Map<string, Owner>();
  for (const system of order) {
    const groups = [
      [system.commands, false],
      [system.internal ?? {}, true],
    ] as const;
    for (const [schemas, internal] of groups) {
      for (const [type, schema] of Object.entries(schemas as Record<string, z.ZodType<Command>>)) {
        const existing = owners.get(type);
        if (existing) {
          throw new RegistryError(
            `指令类型 ${type} 同时由 ${existing.system.id} 和 ${system.id} 注册`,
          );
        }
        const proposal = internal
          ? undefined
          : (system.proposals as Record<string, CommandProposal> | undefined)?.[type];
        owners.set(type, { system, schema, internal, proposal });
      }
    }
    for (const type of Object.keys(system.proposals ?? {})) {
      if (!(type in system.commands)) {
        throw new RegistryError(`${system.id} 的提议格式 ${type} 不是它的模型可用指令`);
      }
    }
  }

  const rules: { readonly system: AnySystem; readonly module: RuleModule }[] = [];
  for (const system of order) {
    for (const module of (system.rules ?? []) as readonly RuleModule[]) {
      if (rules.some((r) => r.module.id === module.id)) {
        throw new RegistryError(`规则模块 id 重复：${module.id}`);
      }
      for (const type of module.commands ?? []) {
        const owner = owners.get(type);
        if (!owner || owner.internal) {
          throw new RegistryError(`规则模块 ${module.id} 说明的 ${type} 不是模型可用的指令`);
        }
      }
      rules.push({ system, module });
    }
  }

  const contextFor = (
    system: AnySystem,
    draft: Draft<WorldState>,
    ctx: ApplyContext,
  ): SystemContext => ({
    rng: ctx.rng,
    facts: ctx.facts ?? {},
    data: ctx.data ?? {},
    now: draft.time,
    read<T>(id: string): T {
      if (!(system.dependsOn ?? []).includes(id)) {
        throw new RegistryError(`${system.id} 没有声明依赖 ${id}，不能读取它的状态`);
      }
      const slice = draft.slices[id];
      return (isDraft(slice) ? current(slice) : slice) as T;
    },
  });

  const advance = (draft: Draft<WorldState>, to: number, ctx: ApplyContext) => {
    if (!Number.isInteger(to)) return `游戏时间必须是整数分钟：${to}`;
    if (to < draft.time) return "游戏时间不能倒退";
    if (to === draft.time) return undefined;
    const span = { from: draft.time, to };
    draft.time = to;
    for (const system of order) {
      system.tick?.(draft.slices[system.id], span, contextFor(system, draft, ctx));
    }
    return undefined;
  };

  const broadcast = (draft: Draft<WorldState>, signal: string, ctx: ApplyContext) => {
    for (const system of order) {
      system.on?.[signal]?.(draft.slices[system.id], contextFor(system, draft, ctx));
    }
  };

  const parse = (raw: unknown, allowInternal: boolean): ParseResult => {
    const type =
      typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
    if (typeof type !== "string") return { ok: false, error: "指令缺少 type 字段" };
    const owner = owners.get(type);
    if (!owner || (owner.internal && !allowInternal)) {
      return { ok: false, error: `未知的指令类型：${type}` };
    }
    const parsed = owner.schema.safeParse(raw);
    return parsed.success
      ? { ok: true, command: parsed.data }
      : { ok: false, error: parsed.error.message };
  };

  /** 结算一条指令和它引起的连锁；返回失败原因，成功时返回 undefined */
  const run = (
    draft: Draft<WorldState>,
    command: Command,
    caller: AnySystem | undefined,
    depth: number,
    notes: string[],
    ctx: ApplyContext,
  ): string | undefined => {
    if (depth > MAX_CHAIN) {
      throw new RegistryError(`指令连锁超过 ${MAX_CHAIN} 层：${command.type}`);
    }
    const parsed = parse(command, true);
    if (!parsed.ok) {
      if (caller) throw new RegistryError(`${caller.id} 发出的指令不合格：${parsed.error}`);
      return parsed.error;
    }
    const { system } = owners.get(parsed.command.type) as Owner;
    if (caller && !(caller.dependsOn ?? []).includes(system.id)) {
      throw new RegistryError(
        `${caller.id} 没有声明依赖 ${system.id}，不能发出 ${parsed.command.type}`,
      );
    }
    const outcome = system.apply(
      draft.slices[system.id],
      parsed.command,
      contextFor(system, draft, ctx),
    );
    if (!outcome.ok) return outcome.reason;
    if (outcome.notes) notes.push(...outcome.notes);
    for (const next of outcome.emit ?? []) {
      const failed = run(draft, next, system, depth + 1, notes, ctx);
      if (failed !== undefined) return failed;
    }
    if (outcome.advanceTo !== undefined) {
      const failed = advance(draft, outcome.advanceTo, ctx);
      if (failed !== undefined) return failed;
    }
    for (const signal of outcome.signals ?? []) broadcast(draft, signal, ctx);
    return undefined;
  };

  return {
    order,
    viewKeys: [...views.keys()],
    project(ctx) {
      return Object.fromEntries([...views].map(([key, { view }]) => [key, view.project(ctx)]));
    },
    actionTypes: () => [...actions.keys()],
    actionSchema(type) {
      return actions.get(type)?.def.schema;
    },
    actionCommands(raw, ctx) {
      const type =
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? (raw as { type?: unknown }).type
          : undefined;
      if (typeof type !== "string") return "界面操作缺少 type 字段";
      const entry = actions.get(type);
      if (!entry) return `未知的界面操作类型：${type}`;
      const parsed = entry.def.schema.safeParse(raw);
      if (!parsed.success) return parsed.error.message;
      if (parsed.data.type !== type) {
        throw new RegistryError(
          `${entry.systemId} 的界面操作 ${type} 与 schema 输出的 type 不一致`,
        );
      }
      return entry.def.commands(parsed.data, ctx);
    },
    sections(ctx) {
      return sectionList.flatMap(({ section }) => {
        const body = section.render(ctx);
        return body === undefined ? [] : [`【${section.title}】\n${body}`];
      });
    },
    objectives(ctx) {
      const result: Objective[] = [];
      const ids = new Set<string>();
      for (const system of order) {
        for (const objective of system.objectives?.(ctx) ?? []) {
          if (objective.source !== system.id || !objective.id.startsWith(`${system.id}:`)) {
            throw new RegistryError(`${system.id} 的待办 ${objective.id} 来源不一致`);
          }
          if (ids.has(objective.id)) {
            throw new RegistryError(`待办 id 重复：${objective.id}`);
          }
          ids.add(objective.id);
          result.push(objective);
        }
      }
      return result;
    },
    threats(ctx) {
      const result: Threat[] = [];
      const ids = new Set<string>();
      for (const system of order) {
        for (const threat of system.threats?.(ctx) ?? []) {
          if (threat.source !== system.id || !threat.id.startsWith(`${system.id}:`)) {
            throw new RegistryError(`${system.id} 的威胁 ${threat.id} 来源不一致`);
          }
          if (ids.has(threat.id)) throw new RegistryError(`威胁 id 重复：${threat.id}`);
          if (!Number.isInteger(threat.level) || threat.level < 0 || threat.level > 5) {
            throw new RegistryError(`威胁 ${threat.id} 的等级 ${threat.level} 不在 0–5`);
          }
          ids.add(threat.id);
          result.push(threat);
        }
      }
      return result;
    },
    initialWorld(time) {
      if (!Number.isInteger(time)) throw new RegistryError(`游戏时间必须是整数分钟：${time}`);
      const slices: Record<string, unknown> = {};
      for (const system of order) slices[system.id] = system.initial();
      return { time, slices };
    },
    commandTypes: () => [...owners].filter(([, o]) => !o.internal).map(([type]) => type),
    commandSchema(type) {
      const owner = owners.get(type);
      return owner && !owner.internal ? (owner.proposal?.schema ?? owner.schema) : undefined;
    },
    normalizeProposal(raw) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { value: raw, note: undefined };
      }
      const type = (raw as { type?: unknown }).type;
      const owner = typeof type === "string" ? owners.get(type) : undefined;
      const legacy = owner?.proposal?.legacy?.(raw as Record<string, unknown>);
      return legacy ? legacy : { value: raw, note: undefined };
    },
    rules: rules.map((r) => r.module),
    activeRules: (world, input) =>
      rules.filter((r) => r.module.when(world.slices[r.system.id], input)).map((r) => r.module),
    parseCommand: (raw) => parse(raw, false),
    parseInternal: (raw) => parse(raw, true),
    applyCommands(world, commands, ctx) {
      let state = world;
      const patches: Patch[] = [];
      const results: AppliedCommand[] = [];
      for (const command of commands) {
        const notes: string[] = [];
        let failed = undefined as string | undefined;
        const [next, commandPatches] = produceWithPatches(state, (draft) => {
          failed = run(draft, command, undefined, 0, notes, ctx);
        });
        if (failed === undefined) {
          state = next;
          patches.push(...commandPatches);
          results.push({ command, result: { ok: true, notes } });
        } else {
          results.push({ command, result: { ok: false, reason: failed } });
        }
      }
      return { world: state, patches, results };
    },
    signal(world, signal, ctx) {
      const [next, patches] = produceWithPatches(world, (draft) => broadcast(draft, signal, ctx));
      return { world: next, patches };
    },
    advanceTo(world, to, ctx) {
      let failed = undefined as string | undefined;
      const [next, patches] = produceWithPatches(world, (draft) => {
        failed = advance(draft, to, ctx);
      });
      if (failed !== undefined) throw new RegistryError(failed);
      return { world: next, patches };
    },
  };
}

function sortByDependencies(systems: readonly AnySystem[]): AnySystem[] {
  const byId = new Map<string, AnySystem>();
  for (const system of systems) {
    if (byId.has(system.id)) throw new RegistryError(`系统 id 重复：${system.id}`);
    byId.set(system.id, system);
  }
  for (const system of systems) {
    for (const dep of system.dependsOn ?? []) {
      if (!byId.has(dep)) throw new RegistryError(`${system.id} 依赖的系统 ${dep} 没有注册`);
    }
  }

  const sorted: AnySystem[] = [];
  const marks = new Map<string, "visiting" | "done">();
  const visit = (system: AnySystem, path: readonly string[]): void => {
    const mark = marks.get(system.id);
    if (mark === "done") return;
    if (mark === "visiting") {
      const cycle = [...path.slice(path.indexOf(system.id)), system.id];
      throw new RegistryError(`系统之间有循环依赖：${cycle.join(" → ")}`);
    }
    marks.set(system.id, "visiting");
    for (const dep of system.dependsOn ?? []) {
      visit(byId.get(dep) as AnySystem, [...path, system.id]);
    }
    marks.set(system.id, "done");
    sorted.push(system);
  };
  for (const system of systems) visit(system, []);
  return sorted;
}
