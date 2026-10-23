import { z } from "zod";

/** 行动类型，决定这一轮时间至少推进多少 */
export const ActivitySchema = z.enum([
  "talk",
  "observe",
  "travel",
  "quickhack",
  "breach",
  "prepare",
  "heal",
  "combat",
  "wait",
  "rest",
]);
export type Activity = z.infer<typeof ActivitySchema>;

/** 时间保底（分钟）；rest 另算，推进到下一个清晨 */
export const ACTIVITY_FLOOR: Readonly<Record<Exclude<Activity, "rest">, number>> = {
  talk: 5,
  observe: 5,
  travel: 5,
  quickhack: 2,
  breach: 30,
  prepare: 30,
  heal: 30,
  combat: 5,
  wait: 5,
};

const GAME_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

export function parseGameTime(text: string): number | undefined {
  const m = GAME_TIME.exec(text);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (h > 23 || mi > 59) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return undefined;
  }
  return ms / 60000;
}

/** 游戏时间字符串，例如 2076-03-14 22:40；换算成从 1970-01-01 00:00 起的分钟数 */
export const GameTimeSchema = z.string().transform((text, ctx) => {
  const minutes = parseGameTime(text);
  if (minutes === undefined) {
    ctx.addIssue({ code: "custom", message: `时间格式应为 YYYY-MM-DD HH:mm：${text}` });
    return z.NEVER;
  }
  return minutes;
});

export const DeadlineSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  due: z.number().int(),
  /** 主持人回应过的游戏时间；没回应时为 null */
  handledAt: z.number().int().nullable(),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

export const WorldClockStateSchema = z.object({
  /** 地图上的地点 id；开局前为 null */
  location: z.string().min(1).nullable(),
  deadlines: z.array(DeadlineSchema),
  /** 第几个场景，从 0 起 */
  scene: z.number().int().min(0),
  sceneStartedAt: z.number().int(),
});
export type WorldClockState = z.infer<typeof WorldClockStateSchema>;

/** 模型使用：{"type": "world", "activity": "talk", "time": "2076-03-14 22:40", "location": "..."} */
export const WorldCommandSchema = z.object({
  type: z.literal("world"),
  activity: ActivitySchema,
  /** 主持人想推进到的时间；早于保底时按保底 */
  time: GameTimeSchema.optional(),
  location: z.string().min(1).optional(),
});
export type WorldCommand = z.infer<typeof WorldCommandSchema>;

/** 模型使用：添加期限（add），或标记到期事件已经回应（handle） */
export const DeadlineCommandSchema = z
  .object({
    type: z.literal("deadline"),
    action: z.enum(["add", "handle"]),
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    due: GameTimeSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "add" && (c.label === undefined || c.due === undefined)) {
      ctx.addIssue({ code: "custom", message: "添加期限要写 label 和 due" });
    }
  });
export type DeadlineCommand = z.infer<typeof DeadlineCommandSchema>;

/** 只能由代码发出：主持人标了 sceneEnd 之后由主持流程发出 */
export const EndSceneSchema = z.object({ type: z.literal("world.endScene") });
export type EndScene = z.infer<typeof EndSceneSchema>;
