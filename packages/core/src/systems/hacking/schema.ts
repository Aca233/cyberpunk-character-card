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

/** 常见黑客手段词典的一条，照原作 2.x 的类别归类；数据在 content 包的 hacking.ts。不是需要装载的程序，也没有容量门槛 */
export const QuickhackDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(12),
  category: QuickhackCategorySchema,
  /** 放出去会怎样；写给模型 */
  effect: z.string().min(1).max(80),
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

export const HackingStateSchema = z.object({
  /** 装着且完好的网络接入仓（义体 id）；由装着的义体推出来，没装或损坏是 null */
  deck: z.string().nullable().default(null),
  /** 玩家已持有/熟悉的快速破解程序（不设硬性槽位门槛，仅用于网客店收藏与擅长提示） */
  programs: z.array(z.string().min(1)).default([]),
  /** 当前现场仍在持续的快速破解效果（例如重启义眼、武器故障、定位、过热灼烧） */
  activeEffects: z.array(ActiveHackEffectSchema).default([]),
  /** 最近对高安保目标高频进攻触发的反追踪警觉标记（场景结束或转移地点后自然散去） */
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
    program: z.string().min(1).describe("手段 id（快速破解参考表里的，用来归类效果）"),
    target: z.string().trim().min(1).max(40).describe("对谁放：对玩家角色写「你」，对别人写称呼"),
  })
  .describe(
    "有卡的人放快速破解：他身上要装着完好的网络接入仓；黑墙攻击还须实际完好的黑墙原型接入仓，通用入侵能力不能替代。上传结束即释放，不积累使用次数。对玩家角色放时，自我 ICE 是否挡下由本轮已确认的设备状态和网络裁决决定。对玩家的伤害类、终极类要经敌方黑客独立裁决 counterHack 与事实绑定（本轮事件 id），代码统一结算伤害，同一裁决只结算一次，不另写 damage 或 combat wound；损坏的自我 ICE 无效；控制、隐蔽类照效果写",
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
      .describe("手段：快速破解参考表里的 id 或名字；表外的写简短的中文说明"),
    target: z.string().trim().min(1).max(40).describe("对谁或什么放"),
    npc: z
      .string()
      .min(1)
      .optional()
      .describe("目标有人物卡时写卡的 id；对有卡的人要先经前置潜网对抗裁决"),
  })
  .describe(
    "快速破解：装着完好网络接入仓的人，一次行动内对符合现场电子设备与义体逻辑的目标放出入侵手段，无需装载、卸载程序，也没有容量门槛；黑墙攻击还须实际完好的黑墙原型接入仓，通用入侵能力不能替代。是否成立看前置的物理与潜网裁决，终极类不自动扣人性",
  );
export type HackCommand = z.infer<typeof HackCommandSchema>;
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
    "入侵协议：接进一个网络，开门、关摄像头、拿数据；必须装着网络接入仓，并且前置物理与潜网裁决确认通过了安全接入条件才记下，不扣 RAM",
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
