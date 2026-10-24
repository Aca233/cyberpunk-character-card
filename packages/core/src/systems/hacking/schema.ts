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

/** 战斗中每打完一段回几格 RAM（本作改编，暂定，试玩时调） */
export const RAM_SEGMENT_REGEN = 1;

/** 快速破解表的一条；数据在 content 包的 hacking.ts */
export const QuickhackDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(12),
  category: QuickhackCategorySchema,
  /** 放一次扣几格 RAM（本作改编：原作的 RAM 数值要配合天赋和实时回复，这里按格子缩过） */
  ram: z.number().int().min(1).max(8),
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

export const HackingStateSchema = z.object({
  /** 装着的网络接入仓（义体 id）；由装着的义体推出来，没装是 null */
  deck: z.string().nullable().default(null),
  /** 剩几格 RAM */
  ram: z.number().int().min(0).default(0),
  /** RAM 上限：接入仓的底数加其他义体的加成 */
  ramMax: z.number().int().min(0).default(0),
  /** 装在接入仓里的快速破解程序 id；格数由接入仓定 */
  programs: z.array(z.string()).default([]),
  /** 入侵协议拿下的网络，最近的在后，最多留 BREACH_KEEP 条 */
  breachedNetworks: z.array(BreachedNetworkSchema).default([]),
});
export type HackingState = z.infer<typeof HackingStateSchema>;

/** 模型使用：{"type": "hack", "program": "overheat", "target": "门口的漩涡帮"} */
export const HackCommandSchema = z
  .object({
    type: z.literal("hack"),
    action: z.enum(["use", "learn", "drop"]).default("use"),
    program: z.string().min(1).describe("程序 id（见【当前状态】的已装程序）"),
    target: z.string().trim().min(1).max(40).optional().describe("use 要写：对谁或什么放"),
    npc: z.string().min(1).optional().describe("目标有人物卡时写卡的 id；对有卡的人要先掷智力"),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("learn、drop 要写：程序是哪来的、为什么删"),
  })
  .superRefine((c, ctx) => {
    if (c.action === "use" && c.target === undefined) {
      ctx.addIssue({ code: "custom", message: "放快速破解要写 target", path: ["target"] });
    }
    if (c.action !== "use" && c.reason === undefined) {
      ctx.addIssue({ code: "custom", message: "learn 和 drop 要写 reason", path: ["reason"] });
    }
  })
  .describe(
    "快速破解：use 放程序（扣 RAM；没装接入仓、没装这个程序或 RAM 不够时代码拦下；终极类代码自动按残忍行为扣人性），learn 装上新程序（买到、从芯片拷来），drop 删掉一个腾出程序格",
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
    "入侵协议：接进一个网络，开门、关摄像头、拿数据；要装网络接入仓，并且本轮智力门槛达标或检定成功，代码核对，不扣 RAM",
  );
export type BreachCommand = z.infer<typeof BreachCommandSchema>;
