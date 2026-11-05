import { z } from "zod";

/** 这一轮主要做了什么；只作记录，过了多久由叙事模型在 time 里写 */
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

/** 3.0 四段相位索引：0 ☀️昼 / 1 🌆昏 / 2 🌙夜 / 3 🌫️晓 */
export const PhaseIndexSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type PhaseIndex = z.infer<typeof PhaseIndexSchema>;

export const PHASE_LABELS: Readonly<Record<PhaseIndex, string>> = {
  0: "☀️昼",
  1: "🌆昏",
  2: "🌙夜",
  3: "🌫️晓",
};

export const PhaseClockSchema = z.object({
  day: z.number().int().min(1).default(1),
  phase: PhaseIndexSchema.default(0),
});
export type PhaseClock = z.infer<typeof PhaseClockSchema>;

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

/**
 * 游戏时间字符串，例如 2076-03-14 22:40；换算成从 1970-01-01 00:00 起的分钟数。
 * 已经换算过的分钟数原样通过：结算时会把校验过的指令再校验一遍，换算必须能重复做。
 * 给模型看的格式只写文本
 */
export const GameTimeSchema = z
  .union([
    z.string().transform((text, ctx) => {
      const minutes = parseGameTime(text);
      if (minutes === undefined) {
        ctx.addIssue({ code: "custom", message: `时间格式应为 YYYY-MM-DD HH:mm：${text}` });
        return z.NEVER;
      }
      return minutes;
    }),
    z.number().int(),
  ])
  .meta({ modelDoc: "文本" });

export const DeadlineSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  due: z.number().int(),
  /** 叙事模型回应过的游戏时间；没回应时为 null */
  handledAt: z.number().int().nullable(),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

/** 存档自己记下的地点 */
export const SavedPlaceSchema = z.object({
  id: z.string().min(1),
  /** 中文名；同名归一，按名字查回同一条 */
  name: z.string().min(1),
  /** 城区中文名，照 DISTRICT_CENTERS */
  district: z.string().min(1),
  /** 街区中文名，照 SUBDISTRICT_SHAPES；选填 */
  sub: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  /** 原作服务点的类别 id（gun、ripperdoc……）；新地点没有 */
  kind: z.string().min(1).optional(),
  /** 底图百分比 */
  x: z.number(),
  y: z.number(),
  firstSeenAt: z.number().int(),
  /** 最近一次到这里的游戏时间；只听说过、没去过的是 null */
  visitedAt: z.number().int().nullable(),
});
export type SavedPlace = z.infer<typeof SavedPlaceSchema>;

export const WorldClockStateSchema = z.object({
  /** 地图上的地点 id；开局前为 null */
  location: z.string().min(1).nullable(),
  deadlines: z.array(DeadlineSchema),
  /** 第几个场景，从 0 起 */
  scene: z.number().int().min(0),
  sceneStartedAt: z.number().int(),
  /** 存档记下的地点，并进地点表；旧存档没有这个字段，当空表 */
  places: z.array(SavedPlaceSchema).default([]),
  /** 3.0 连续未睡眠的相位数（连续 ≥ 4 相位不睡挂疲劳：全属性 -1） */
  phasesAwake: z.number().int().min(0).default(0),
  /** 3.0 最近 7 天服用黑蕾丝（Black Lace）的时间点（分钟） */
  blackLaceDoses: z.array(z.number().int()).default([]),
  /** 3.0 黑蕾丝药效维持截止时间（期间无视伤势减值且肉体 +2） */
  blackLaceActiveUntil: z.number().int().nullable().default(null),
});
export type WorldClockState = z.infer<typeof WorldClockStateSchema>;

export const NewPlaceSchema = z.object({
  name: z.string().min(1),
  in: z.string().min(1),
  note: z.string().min(1).optional(),
});
export type NewPlace = z.infer<typeof NewPlaceSchema>;

/** 模型使用：{"type": "world", "activity": "talk", "time": "2076-03-14 22:40", "location": "..."} */
export const WorldCommandSchema = z
  .object({
    type: z.literal("world"),
    activity: ActivitySchema,
    /** 这一轮结束时是几点，按情境写；不能早于现在，没写就是时间没动 */
    time: GameTimeSchema.optional(),
    /** 3.0 相位推进步数（跨区办事、打完一场委托、动手术、睡觉各耗 1 相位） */
    phases: z.number().int().min(0).max(4).optional(),
    /** 【地点】里的 id；到了新地方写 {name, in} */
    location: z.union([z.string().min(1), NewPlaceSchema]).optional(),
  })
  .describe(
    "每轮一条：activity 记这一轮主要做了什么；time 写这一轮结束时是几点（YYYY-MM-DD HH:mm），不能早于现在，没写就是时间没动；location 是换到的地点：【地点】里有的写 id，没有的新地方写 {name, in（城区中文名，必填）, note?}，不写坐标",
  );
export type WorldCommand = z.infer<typeof WorldCommandSchema>;

/** 模型使用：添加期限（add），或标记这件事已经办完或到期事件已经回应（handle） */
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
  })
  .describe(
    "期限：add 添加（要写 label 和 due）；handle 标记这件事已经了结——提前办完、办砸了、或者到期后已经回应",
  );
export type DeadlineCommand = z.infer<typeof DeadlineCommandSchema>;

/** 地点表的一条：原作固定地点（content 包的 locations.ts），和存档记下的地点（并进来的） */
export const LocationDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 所在地区的中文名，例如沃森、威斯特布鲁克 */
  district: z.string().min(1),
  /** 给模型看的一句话 */
  note: z.string().min(1).optional(),
  /** 地图上的位置：底图宽、高的百分比（0–100），在 /dev/calibrate 校准；没写的不上地图 */
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  /** 附近有 NCART 轻轨站 */
  metro: z.boolean().optional(),
  /** 原作服务点的类别 id（gun、ripperdoc……）：【地点】里写成类别名，模型按类别挑店 */
  kind: z.string().min(1).optional(),
});
export type LocationDef = z.infer<typeof LocationDefSchema>;

export const LocationCatalogSchema = z.array(LocationDefSchema);

const locationCatalogs = new WeakMap<object, ReadonlyMap<string, LocationDef>>();

/** 读取并校验地点表；没有地点表时是空表，地点 id 本来就可以是表外的 */
export function locationCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, LocationDef> {
  const raw = data.locations;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = locationCatalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map<string, LocationDef>();
  for (const place of LocationCatalogSchema.parse(raw)) {
    if (catalog.has(place.id)) throw new Error(`地点表里的 id 重复：${place.id}`);
    catalog.set(place.id, place);
  }
  locationCatalogs.set(raw, catalog);
  return catalog;
}

/** 只能由代码发出：叙事模型标了 sceneEnd 之后由回合流程发出 */
export const EndSceneSchema = z.object({ type: z.literal("world.endScene") });
export type EndScene = z.infer<typeof EndSceneSchema>;
