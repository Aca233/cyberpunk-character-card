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
export const WorldCommandSchema = z
  .object({
    type: z.literal("world"),
    activity: ActivitySchema,
    /** 主持人想推进到的时间；早于保底时按保底 */
    time: GameTimeSchema.optional(),
    location: z.string().min(1).optional(),
  })
  .describe(
    "每轮一条：这一轮主要做了什么，代码按类别保底推进时间；time 是想推进到的时间（YYYY-MM-DD HH:mm），location 是换到的地点 id",
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

/** 地点表的一条；数据在 content 包的 locations.ts，只用来显示中文名和告诉模型有哪些常用地点 */
export const LocationDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 所在地区的中文名，例如沃森、威斯特布鲁克 */
  district: z.string().min(1),
  /** 给模型看的一句话 */
  note: z.string().min(1).optional(),
  /** 大街（street）、帮派地盘（gang）还是公司产区（corp）；警方热度按这个分账 */
  zone: z.enum(["street", "gang", "corp"]).default("street"),
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

/** 只能由代码发出：主持人标了 sceneEnd 之后由主持流程发出 */
export const EndSceneSchema = z.object({ type: z.literal("world.endScene") });
export type EndScene = z.infer<typeof EndSceneSchema>;
