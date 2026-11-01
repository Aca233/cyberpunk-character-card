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

/**
 * 地点簿的一条（places-plan §四，第 ③ 层；第一次去的原作服务点、地标也记在这里，§五）。
 * id 由代码生成：新地点 place:<序号>，原作服务点 poi:<id>，原作地标 ft:<id>
 */
export const SavedPlaceSchema = z.object({
  id: z.string().min(1),
  /** 中文名；同名归一，按名字查回同一条 */
  name: z.string().min(1),
  /** 城区中文名，照 DISTRICT_CENTERS */
  district: z.string().min(1),
  /** 街区中文名，照 SUBDISTRICT_SHAPES；选填，写错的已丢掉（用户定的，§四） */
  sub: z.string().min(1).optional(),
  /** 建的时候说在哪个已知地点附近 */
  near: z.string().min(1).optional(),
  /**
   * 场景点（天台、后巷、包间……）挂在哪个地点下面（用户定的：场景点挂在所属地点下，不单独钉，2026-10-30）：
   * 坐标照上级的，地图上不单独画；同一个上级下面同名的算同一处
   */
  parent: z.string().min(1).optional(),
  /**
   * 临时地点：在第几个场景建的（用户定的：新地点先临时，用到第二次才转正，2026-10-30）。
   * 换了场景以后又去了、从这里出发出行过，就转正（去掉这个字段）；没转正的不进【地点簿】、不进周边，留在存档里不删
   */
  tempScene: z.number().int().min(0).optional(),
  note: z.string().min(1).optional(),
  /** 原作服务点的类别 id（gun、ripperdoc……）；新地点没有 */
  kind: z.string().min(1).optional(),
  /** 模型给原作服务点起的称呼：本作改编，只当别名，不冒充原作店名（§五） */
  alias: z.string().min(1).optional(),
  /** 底图百分比 */
  x: z.number(),
  y: z.number(),
  /** 代码推算的大概位置；原作坐标的是 false */
  rough: z.boolean(),
  /**
   * 玩家在地图上拖过、改过坐标的游戏时间（places-plan 第二期，用户定的 2026-10-30）；
   * 只说明是玩家放的，不算核对过的原作入口，rough 照旧
   */
  movedAt: z.number().int().optional(),
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
  /** 地点簿（§四）；旧存档没有这个字段，当空表（§九） */
  places: z.array(SavedPlaceSchema).default([]),
});
export type WorldClockState = z.infer<typeof WorldClockStateSchema>;

/** 八方位，和周边雷达同一套写法（§十三②） */
export const PlaceDirSchema = z.enum(["北", "东北", "东", "东南", "南", "西南", "西", "西北"]);
/** 近、中、远约 100、300、800 米（§十三②，本作改编） */
export const PlaceDistSchema = z.enum(["近", "中", "远"]);

/**
 * world 的 location 直接写新地方（用户定的：新地点并进 location，place 只留给听说过的，2026-10-30）：
 * name 中文名，in 城区中文名（必填）；sub、near、from+dir+dist、note 和 place 指令同一套写法，不写坐标
 */
export const NewPlaceSchema = z.object({
  name: z.string().min(1),
  in: z.string().min(1),
  sub: z.string().min(1).optional(),
  near: z.string().min(1).optional(),
  /** 场景点（天台、后巷、包间……）挂在哪个已知地点下面：坐标照上级，地图上不单独钉（用户定的，2026-10-30） */
  parent: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  dir: PlaceDirSchema.optional(),
  dist: PlaceDistSchema.optional(),
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
    /** 地点 id 或中文名；到了表外的新地方写 {name, in, ...} */
    location: z.union([z.string().min(1), NewPlaceSchema]).optional(),
  })
  .describe(
    "每轮一条：activity 记这一轮主要做了什么；time 写这一轮结束时是几点（YYYY-MM-DD HH:mm），过了多久由你按情境定（一句寒暄可以不过一分钟，一场谈判半小时，睡到第二天几点也由你写），不能早于现在，没写就是时间没动；location 是换到的地点 id（或中文名），到了【常用地点】【地点簿】【周边】都没有的新地方写 {name, in（城区中文名，必填）, sub?, near? 或 from+dir+dist?, note?}，不写坐标，代码贴着原作路面放；收场（sceneEnd）不会自动推进时间，过了多久照样写在 time 里",
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

/** 原作服务点的 13 类，照原作地图图例（MAP_POI_KINDS） */
export const PlaceKindSchema = z.enum([
  "fixer",
  "ripperdoc",
  "gun",
  "melee",
  "netrunner",
  "clothes",
  "meds",
  "junk",
  "food",
  "bar",
  "apartment",
  "rent",
  "autofixer",
]);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

/**
 * 模型使用：到了表外的新地方（places-plan §四），或者去某一类原作店（§五，写 kind）。
 * 不写坐标，坐标由代码推算；district 必须是城区表里的名字，否则拒收
 */
export const PlaceCommandSchema = z
  .object({
    type: z.literal("place"),
    /** 中文名；写 kind 时可以不写，写了只当别名 */
    name: z.string().min(1).optional(),
    district: z.string().min(1),
    sub: z.string().min(1).optional(),
    /** 在哪个已知地点附近：地点 id、poi:、ft:、place: 都行 */
    near: z.string().min(1).optional(),
    /** 场景点挂在哪个已知地点下面：坐标照上级，地图上不单独钉（用户定的，2026-10-30） */
    parent: z.string().min(1).optional(),
    /** 相对【当前状态】周边里的一个 id：from + dir + dist（§十三②） */
    from: z.string().min(1).optional(),
    dir: PlaceDirSchema.optional(),
    dist: PlaceDistSchema.optional(),
    kind: PlaceKindSchema.optional(),
    note: z.string().min(1).optional(),
    /** 只是听说、玩家没去：记进地点簿，不换位置 */
    heard: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.name === undefined && c.kind === undefined) {
      ctx.addIssue({ code: "custom", message: "place 要写 name（新地点）或 kind（某类原作店）" });
    }
  })
  .describe(
    "地点簿（用户定的：亲自到的新地方写在 world 的 location {name, in} 里，place 只留给下面两种，2026-10-30）：只是听说、玩家没去的地方写 name + district（必填，城区中文名）+ heard: true，sub、near 或 from+dir+dist 选填，不写坐标，只记下、不换位置；要去某类店写 kind + district（可加 sub），代码挑一家原作的店，玩家换到那里",
  );
export type PlaceCommand = z.infer<typeof PlaceCommandSchema>;

/** 地点表的一条；数据在 content 包的 locations.ts，只用来显示中文名和告诉模型有哪些常用地点 */
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
  /** 坐标是代码推算的大概位置（地点簿里的新地点，places-plan §四）；出行和周边都标"大概" */
  rough: z.boolean().optional(),
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

/**
 * 只能由代码发出：玩家在地图上把剧情里记下的地点（place:）拖到准确的位置（places-plan 第二期，用户定的 2026-10-30）。
 * 不调用模型；原作店和地标照原作坐标，不能拖
 */
export const MovePlaceSchema = z.object({
  type: z.literal("world.movePlace"),
  id: z.string().min(1),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});
export type MovePlace = z.infer<typeof MovePlaceSchema>;
