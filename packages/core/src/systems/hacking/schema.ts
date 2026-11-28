import { z } from "zod";

/** 快速破解的类别，照原作 2.x：控制、隐蔽、伤害、终极 */
export const QUICKHACK_CATEGORIES = ["control", "covert", "damage", "ultimate"] as const;
export const QuickhackCategorySchema = z.enum(QUICKHACK_CATEGORIES);
export type QuickhackCategory = z.infer<typeof QuickhackCategorySchema>;
export const CATEGORY_LABELS: Readonly<Record<QuickhackCategory, string>> = {
  control: "控制",
  covert: "隐蔽",
  damage: "伤害",
  ultimate: "终极",
};

/** 快速破解的算力与神经热负荷档次：低负载、中负载、高负载、极高过载 */
export const HACK_LOADS = ["light", "medium", "heavy", "extreme"] as const;
export const HackLoadSchema = z.enum(HACK_LOADS);
export type HackLoad = z.infer<typeof HackLoadSchema>;
export const HACK_LOAD_LABELS: Readonly<Record<HackLoad, string>> = {
  light: "低负载",
  medium: "中负载",
  heavy: "高负载",
  extreme: "极高过载",
};

/** 接入仓与神经突触的定性热负荷档次：常温稳定 → 轻度升温 → 芯片发烫 → 过载临界 */
export const THERMAL_LEVELS = ["cool", "warm", "hot", "critical"] as const;
export const ThermalLevelSchema = z.enum(THERMAL_LEVELS);
export type ThermalLevel = z.infer<typeof ThermalLevelSchema>;
export const THERMAL_LABELS: Readonly<Record<ThermalLevel, string>> = {
  cool: "常温稳定",
  warm: "轻度升温",
  hot: "芯片发烫",
  critical: "过载临界",
};
export const THERMAL_MAX_HEAT = 6;

/** 快速破解程序芯片目录的一条，照原作 2.x 的类别归类；数据在 content 包的 hacking.ts */
export const QuickhackDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(12),
  category: QuickhackCategorySchema,
  /** 上传该程序对接入仓与神经造成的算力热负荷档次 */
  load: HackLoadSchema.default("medium"),
  /** 是否必须先破开目标个人黑冰、建立深层立足点才能上传（终极神经接管类） */
  requiresFoothold: z.boolean().default(false),
  /** 硬件与无线接口前提说明（例如需联网义眼、联网枪械、体内电子义体） */
  targetRequirement: z.string().min(1).max(60).optional(),
  /** 物理与硬件层面的实际破坏效果；写给模型 */
  effect: z.string().min(1).max(140),
  /** 出处：原作依据（版本）或本作改编 */
  source: z.string().min(1),
});
export type QuickhackDef = z.infer<typeof QuickhackDefSchema>;
export const QuickhackCatalogSchema = z.array(QuickhackDefSchema);

/** 入侵协议能拿到的东西：开门、关摄像头、关或接管炮塔、拿数据、关警报 */
export const BREACH_GAINS = ["doors", "cameras", "turrets", "data", "alarms"] as const;
export const BreachGainSchema = z.enum(BREACH_GAINS);
export type BreachGain = z.infer<typeof BreachGainSchema>;
export const BREACH_GAIN_LABELS: Readonly<Record<BreachGain, string>> = {
  doors: "门禁",
  cameras: "摄像头",
  turrets: "炮塔",
  data: "数据",
  alarms: "警报",
};
/** 记几条入侵过的网络 */
export const BREACH_KEEP = 20;

export const BreachedNetworkSchema = z.object({
  name: z.string().min(1),
  /** 在哪个地点（地点 id）；不在已知地点时是 null */
  location: z.string().nullable(),
  at: z.number().int(),
  gains: z.array(BreachGainSchema),
});
export type BreachedNetwork = z.infer<typeof BreachedNetworkSchema>;

/** 本次目标内部接入深入程度的五档显示；不代表全网地理、固定防线或自动取得的权限。 */
export const DIVE_LAYERS = [
  "入口接入",
  "外围访问",
  "内部访问",
  "核心访问",
  "目标范围边界",
] as const;
export const DIVE_MAX = DIVE_LAYERS.length;
export const DiveSchema = z.object({
  /** 当前目标内部的接入深入档位，从 1 起；风险与权限由实际网络事实决定。 */
  layer: z.number().int().min(1).max(DIVE_MAX),
  startedAt: z.number().int(),
  /** 潜网椅在哪 */
  chair: z.string().min(1),
  /** 谁守着肉身 */
  guard: z.string().min(1),
  /** 当前潜网会话在各层已确认的进展与发现（节点、冰墙、反制、数据等） */
  notes: z.array(z.string().min(1)).default([]),
});
export type Dive = z.infer<typeof DiveSchema>;

/** 持续生效的快速破解状态（由 applyHack 写入，供后续裁决与叙事感知，并在场景切换或目标脱离后自然失效） */
export const ActiveHackEffectSchema = z.object({
  program: z.string().min(1),
  label: z.string().min(1),
  category: QuickhackCategorySchema.nullable(),
  target: z.string().min(1),
  npc: z.string().min(1).optional(),
  location: z.string().nullable(),
  at: z.number().int(),
  effect: z.string().min(1),
});
export type ActiveHackEffect = z.infer<typeof ActiveHackEffectSchema>;

/** 最多保留的活跃快速破解状态条数 */
export const ACTIVE_HACK_KEEP = 10;
/** 最多保留的已破冰目标记录条数 */
export const BREACHED_TARGET_KEEP = 12;

/** 已捅穿个人防火墙/自卫黑冰并取得立足点的现场目标（场景切换或离开现场后失效） */
export const BreachedTargetSchema = z.object({
  target: z.string().min(1),
  npc: z.string().min(1).optional(),
  location: z.string().nullable(),
  at: z.number().int(),
  via: z.string().min(1).optional(),
});
export type BreachedTarget = z.infer<typeof BreachedTargetSchema>;

/** 接入仓与神经热负荷状态（替代蓝条/回蓝：随连续并发高负载程序升温，随时间与冷却设施自然散热） */
export const ThermalStateSchema = z.object({
  /** 内部积热刻度 0–6：0 常温稳定，1–2 轻度升温，3–4 芯片发烫，5–6 过载临界 */
  heat: z.number().int().min(0).max(THERMAL_MAX_HEAT).default(0),
  /** 最近一次积热或散热的时间（游戏分钟） */
  updatedAt: z.number().int().default(0),
  /** 本场因顶着过热硬发导致神经灼伤的次数 */
  overloadCount: z.number().int().min(0).default(0),
});
export type ThermalState = z.infer<typeof ThermalStateSchema>;

export const HackingStateSchema = z.object({
  /** 装着且完好的网络接入仓（义体 id）；由装着的义体推出来，没装或损坏是 null */
  deck: z.string().nullable().default(null),
  /** 接入仓当前插装在存储插槽里的热待命程序芯片 id 列表（受接入仓硬件编译容量上限约束） */
  programs: z.array(z.string().min(1)).default([]),
  /** 随身芯片盒中持有的全部程序芯片库（未插装的芯片可在脱战且未潜网时换插进存储插槽） */
  ownedPrograms: z.array(z.string().min(1)).default([]),
  /** 是否已完成首次装仓时的出厂基础程序烧录（避免先买芯片再装仓漏发基础芯片，也不在玩家主动清空槽位后重复回填） */
  starterSeeded: z.boolean().default(false),
  /** 接入仓与神经热负荷状态 */
  thermal: ThermalStateSchema.default({ heat: 0, updatedAt: 0, overloadCount: 0 }),
  /** 当前现场已捅穿个人黑冰、建立入侵立足点的目标列表 */
  breachedTargets: z.array(BreachedTargetSchema).default([]),
  /** 当前现场仍在持续的快速破解效果（例如重启义眼、武器故障、定位、义体过热） */
  activeEffects: z.array(ActiveHackEffectSchema).default([]),
  /** 最近对高安保目标高频进攻或破冰受阻触发的反追踪警觉标记（场景结束或转移地点后自然散去） */
  traceAlert: z
    .object({
      at: z.number().int(),
      location: z.string().nullable(),
      target: z.string().min(1),
    })
    .nullable()
    .default(null),
  /** 入侵协议拿下的网络，最近的在后，最多留 BREACH_KEEP 条 */
  breachedNetworks: z.array(BreachedNetworkSchema).default([]),
  /** 正在潜网；没在潜是 null */
  dive: DiveSchema.nullable().default(null),
  /** 已登记的快速破解事件 id；防止同一事件重复制造伤势 */
  resolvedNpcHacks: z.array(z.string().min(1)).default([]),
});
export type HackingState = z.infer<typeof HackingStateSchema>;

/** 模型使用：{"type": "npcHack", "id": "placide", "program": "overheat", "target": "你"} */
export const NpcHackCommandSchema = z
  .object({
    type: z.literal("npcHack"),
    id: z.string().min(1).describe("放快速破解的人的卡 id"),
    program: z.string().min(1).describe("程序 id（快速破解程序表里的，用来归类物理效果）"),
    target: z.string().trim().min(1).max(40).describe("对谁放：对玩家角色写「你」，对别人写称呼"),
  })
  .describe(
    "有卡的人放快速破解：他身上要装着完好的网络接入仓；黑墙攻击还须实际完好的黑墙原型接入仓，通用入侵能力不能替代。对玩家角色放时，个人防火墙与完好自我 ICE 是否挡下由本轮已确认的设备状态和独立反制裁决 counterHack 决定。对玩家的伤害类、终极类由代码统一依据 counterHack 结算神经创伤，同一裁决只结算一次，不另写 damage 或 combat wound；损坏的自我 ICE 无效；控制、隐蔽类照硬件与感官故障写",
  );
export type NpcHackCommand = z.infer<typeof NpcHackCommandSchema>;

/** 模型使用：{"type": "hack", "program": "overheat", "target": "门口的漩涡帮"} */
export const HackCommandSchema = z
  .object({
    type: z.literal("hack"),
    program: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe("程序芯片：接入仓已插装的程序 id 或名字；现场临时改写的街头小脚本写简短中文说明"),
    target: z.string().trim().min(1).max(40).describe("对谁或什么设备放"),
    npc: z.string().min(1).optional().describe("目标有人物卡时写卡的 id；先过个人黑冰与链路裁决"),
    iceBreached: z
      .boolean()
      .optional()
      .describe("本轮是否同步捅穿了目标的个人黑冰/防火墙并建立立足点（true 时写入已破冰记录）"),
  })
  .describe(
    "电子战快速破解：须装有完好网络接入仓，目标须具备可接入的电子义体/联网接口且无线未被物理离线或气隙隔断；调用目录程序须已插装对应程序芯片；终极神经接管类（自我了断、赛博精神病、系统崩溃）须先捅穿目标个人黑冰建立立足点。上传按程序算力档位累计接入仓与神经热负荷，过热临界硬发会反烧大脑造成神经创伤。黑墙攻击还须完好黑墙原型接入仓。终极类不自动扣人性",
  );
export type HackCommand = z.infer<typeof HackCommandSchema>;

/** 模型使用：{"type": "deckLoad", "action": "slot", "program": "overheat"} */
export const DeckLoadCommandSchema = z
  .object({
    type: z.literal("deckLoad"),
    action: z
      .enum(["acquire", "slot", "unslot"])
      .describe(
        "acquire 购入/拷贝获得新程序芯片（若装有完好接入仓且存储插槽未满顺带插装）；slot 将随身芯片盒中已持有的芯片插进存储插槽；unslot 从存储插槽拔下芯片退回随身芯片盒",
      ),
    program: z.string().trim().min(1).max(40).describe("快速破解程序目录中的 id 或中文名"),
    replace: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .optional()
      .describe("存储插槽已满时，可选指定要拔下腾位的已插装程序 id 或中文名"),
  })
  .describe(
    "管理接入仓程序芯片：获得（购买/拷贝/搜刮）快速破解芯片，或在脱战且未潜网时插拔接入仓存储插槽里的热待命程序芯片；不同接入仓的存储插槽与编译容量上限不同，实战只能直接调用当前插在槽位里的程序",
  );
export type DeckLoadCommand = z.infer<typeof DeckLoadCommandSchema>;
/** 模型使用：{"type": "breach", "network": "漩涡帮仓库的内网", "via": "卸货口旁的接入点", "gains": ["cameras", "doors"]} */
export const BreachCommandSchema = z
  .object({
    type: z.literal("breach"),
    network: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .describe("入侵的是哪个网络，比如「漩涡帮仓库的内网」"),
    via: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .describe("从哪里接进去：接入点、终端、对方的义体"),
    gains: z
      .array(BreachGainSchema)
      .min(1)
      .max(BREACH_GAINS.length)
      .describe("拿到了什么：doors 门禁，cameras 摄像头，turrets 炮塔，data 数据，alarms 警报"),
  })
  .describe(
    "入侵协议：接进一个网络，开门、关摄像头、拿数据；必须装着网络接入仓，并且前置物理与潜网裁决确认通过了安全接入条件才记下，不扣 RAM。同一地点同一网络扩权沿用原 network，gains 只写本次新拿到的权限；代码合并既有权限，重复权限不再结算",
  );
export type BreachCommand = z.infer<typeof BreachCommandSchema>;

/** 模型使用：{"type": "dive", "action": "start", "chair": "朱迪公寓里的潜网椅", "guard": "朱迪"} */
export const DiveCommandSchema = z
  .object({
    type: z.literal("dive"),
    action: z.enum(["start", "deeper", "surface"]),
    chair: z.string().trim().min(1).max(30).optional().describe("start 要写：潜网椅在哪"),
    guard: z.string().trim().min(1).max(20).optional().describe("start 要写：谁守着肉身"),
    reason: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "start" && (c.chair === undefined || c.guard === undefined)) {
      ctx.addIssue({ code: "custom", message: "开始潜网要写 chair 和 guard", path: ["chair"] });
    }
  })
  .describe(
    "潜网：start 躺上潜网椅接入本次目标网络（要接入仓、潜网椅和守着肉身的人，战斗中不行），deeper 记录在该目标内部实际完成的进一步接入，需通过现场链路、权限与防线裁决；五档只是深入程度，不凭档位增加风险、取得权限或进入其他网络。surface 退出回到肉身；切换场景不自动退出",
  );
export type DiveCommand = z.infer<typeof DiveCommandSchema>;
