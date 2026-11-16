import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gameContent } from "@cp/content";
import {
  type Command,
  characterRules,
  type LogRecord,
  LogRecordSchema,
  type NarratorPlan,
  newGameWorld,
  registry,
  TurnInputSchema,
  type TurnRecord,
  type WorldState,
  withAllSlices,
  worldRules,
} from "@cp/core";
import { z } from "zod";

/**
 * 测评用例：一个开局状态、几轮历史、这一轮的玩家输入，以及期望。
 * 每条用例一个 JSON 文件，放在 tools/evals/
 */

/** 没写角色时用的测评角色；只为测评准备，不进游戏内容 */
export const EVAL_CHARACTER = {
  name: "洛·门多萨",
  brief:
    "在沃森区长大的街头小子，给小诊所和车行打零工的修理工。会修车、懂一点电子锁，不会骇客，没装战斗义体。话少，记仇，对帮派没好感。",
  // 内核建档占位字段（实际叙事与裁决不再使用属性点）
  attributes: { body: 2, reflexes: 2, tech: 2, intelligence: 2, cool: 2 },
  streetCred: 3,
} as const;

const HistoryTurnSchema = z.strictObject({
  input: TurnInputSchema,
  /** 叙事模型当时的正文 */
  text: z.string().min(1),
  /** 当时生效的指令，按模型可用的格式写；没有 world 时补一条 talk */
  commands: z.array(z.unknown()).default([]),
});

const MatchSchema = z.strictObject({
  require: z.array(z.string()).default([]),
  forbid: z.array(z.string()).default([]),
});

export const EvalCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/, "id 用小写英文、数字和连字符"),
    title: z.string().min(1),
    /** 覆盖面标签：intent、voice、causality、grounding、bounds、modules、ooc、anti-gaminess、preset…… */
    tags: z.array(z.string().min(1)).min(1),
    setup: z
      .strictObject({
        startTime: worldRules.GameTimeSchema.prefault("2077-01-01 22:00"),
        character: characterRules.SetCharacterSchema.omit({ type: true }).optional(),
        /** 开局前由代码执行的指令，内部指令也可以，例如人性、开战 */
        commands: z.array(z.unknown()).default([]),
        history: z.array(HistoryTurnSchema).default([]),
        /** 从试玩存档截出来的：这一轮之前的世界和回合日志；有它时不用上面几项搭开局 */
        snapshot: z
          .strictObject({
            /** 存档的开场设定，故事还没开始时进提示词 */
            opening: z.string().optional(),
            world: z.custom<WorldState>(
              (v) => typeof v === "object" && v !== null && "slices" in v && "time" in v,
              "world 要是存档里的世界状态",
            ),
            records: z.array(LogRecordSchema),
          })
          .optional(),
      })
      .prefault({}),
    /** 这一轮的玩家输入 */
    input: TurnInputSchema,
    /** 只测记账：这一轮的正文由用例写死，判断和写正文不调模型，只有抽取调辅助模型 */
    narrative: z.string().min(1).optional(),
    /** 和 narrative 一起用：判断那一步的固定结果，不写时按“不裁决、不调记忆”处理 */
    judged: z.record(z.string(), z.unknown()).optional(),
    expect: z
      .strictObject({
        /** ① 判断 */
        judge: z
          .strictObject({
            /** 定性物理/社会因果裁决（ruling） */
            ruling: z
              .strictObject({
                /** true：应当给出裁决；false：日常动作不应无事生非（ruling 为 null） */
                present: z.boolean().optional(),
                match: MatchSchema.prefault({}),
              })
              .optional(),
            /** 判断认为是场外提问 */
            ooc: z.boolean().optional(),
            /** 意图（read）里必须出现 / 不能出现的内容（正则） */
            read: MatchSchema.prefault({}),
          })
          .prefault({}),
        /** ④ 抽取提了什么（规则和防呆校验之前），按 type 或 type.action 匹配；require 没提是漏抽，forbid 提了是误抽 */
        extract: MatchSchema.prefault({}),
        /** 经规则、防呆和业务校验之后真正生效的指令 */
        applied: MatchSchema.prefault({}),
        modules: MatchSchema.prefault({}),
        /** 正文里必须出现 / 不能出现的内容（正则） */
        text: MatchSchema.prefault({}),
        maxChars: z.number().int().min(1).optional(),
      })
      .prefault({}),
    /** 评分模型按条打 1–5 分 */
    rubric: z.array(z.string().min(1)).default([]),
    /** 存为用例时模型当时的回复，只供补期望时参考 */
    actual: z.unknown().optional(),
  })
  .refine(
    (c) => c.judged === undefined || c.narrative !== undefined,
    "judged 要和 narrative 一起写",
  );
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export async function loadCases(dir: string): Promise<EvalCase[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = EvalCaseSchema.safeParse(JSON.parse(await readFile(join(dir, file), "utf8")));
    if (!parsed.success) {
      throw new Error(`用例 ${file} 格式不对：${z.prettifyError(parsed.error)}`);
    }
    if (seen.has(parsed.data.id)) throw new Error(`用例 id 重复：${parsed.data.id}（${file}）`);
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  }
  return cases;
}

export interface Scenario {
  readonly world: WorldState;
  readonly records: readonly LogRecord[];
  readonly plan: NarratorPlan;
  /** 开场设定；只有从存档截出的用例有 */
  readonly opening?: string | undefined;
}

const SETUP_AT = "2026-01-01T00:00:00.000Z";
const setupRng = { roll: () => 1 };

function applyAll(
  world: WorldState,
  raw: readonly unknown[],
  internal: boolean,
  where: string,
): { world: WorldState; commands: Command[]; patches: TurnRecord["patches"] } {
  const commands = raw.map((item, i) => {
    const parsed = internal ? registry.parseInternal(item) : registry.parseCommand(item);
    if (!parsed.ok) throw new Error(`${where} 第 ${i + 1} 条指令不合格：${parsed.error}`);
    return parsed.command;
  });
  const applied = registry.applyCommands(world, commands, { rng: setupRng });
  for (const { command, result } of applied.results) {
    if (!result.ok) throw new Error(`${where} 的 ${command.type} 没有生效：${result.reason}`);
  }
  return { world: applied.world, commands, patches: applied.patches as TurnRecord["patches"] };
}

/** 按用例搭出存档状态和这一轮的计划；用例本身有问题时报错 */
export function buildScenario(c: EvalCase): Scenario {
  const { setup } = c;
  if (setup.snapshot) return fromSnapshot(c, setup.snapshot);
  let world = newGameWorld({ startTime: setup.startTime }, gameContent);
  const character = setup.character ?? EVAL_CHARACTER;
  world = applyAll(
    world,
    [{ type: "character.set", ...character }, ...setup.commands],
    true,
    "开局",
  ).world;

  const records: LogRecord[] = [];
  for (const [i, turn] of setup.history.entries()) {
    const applied = applyAll(world, turn.commands, false, `第 ${i + 1} 轮历史`);
    world = applied.world;
    const seq = records.length;
    records.push({
      kind: "turn",
      seq,
      at: SETUP_AT,
      requestId: `setup-${seq}`,
      baseVersion: seq,
      input: turn.input,
      dice: [],
      commands: applied.commands,
      dropped: [],
      text: turn.text,
      patches: applied.patches,
    });
  }

  return { world, records, plan: { kind: "action", input: c.input } };
}

/** 从存档截出的用例：世界和回合日志原样保留 */
function fromSnapshot(c: EvalCase, snapshot: NonNullable<EvalCase["setup"]["snapshot"]>): Scenario {
  return {
    world: withAllSlices(snapshot.world),
    records: snapshot.records,
    opening: snapshot.opening,
    plan: { kind: "action", input: c.input },
  };
}
