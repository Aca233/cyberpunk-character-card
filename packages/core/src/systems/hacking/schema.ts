import { z } from "zod";
import type { DamageTier } from "../dice";

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

/** 潜网的层（本作改编，取自《边缘行者》的潜网和原作的黑墙）：越往下越危险，最底下是黑墙边缘 */
export const DIVE_LAYERS = [
  "本地子网",
  "城区网络",
  "公司数据堡垒",
  "网络监察巡查带",
  "黑墙边缘",
] as const;
export const DIVE_MAX = DIVE_LAYERS.length;
/** 潜到这一层的检定至少要事先写明多重的伤害（神经反噬）；没列的层不强制 */
export const DIVE_DAMAGE: Readonly<Partial<Record<number, DamageTier>>> = {
  3: "heavy",
  4: "heavy",
  5: "lethal",
};

export const DiveSchema = z.object({
  /** 第几层，从 1 起 */
  layer: z.number().int().min(1).max(DIVE_MAX),
  startedAt: z.number().int(),
  /** 潜网椅在哪 */
  chair: z.string().min(1),
  /** 谁守着肉身 */
  guard: z.string().min(1),
});
export type Dive = z.infer<typeof DiveSchema>;

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
  /** 正在潜网；没在潜是 null */
  dive: DiveSchema.nullable().default(null),
  /**
   * 有卡的人放快速破解用掉的 RAM（用户 2026-11-02 选的"代码结算"）：人物 id → 已用格数。
   * 战斗中每打完一段回 RAM_SEGMENT_REGEN 格，战斗收尾、场景结束、休整清空；旧存档没有
   */
  npcRamUsed: z.record(z.string(), z.number().int().min(0)).default({}),
  /** 玩家装着的自我 ICE 这一场已经替他挡过一次快速破解；战斗收尾、场景结束、休整后恢复；旧存档没有 */
  selfIceSpent: z.boolean().default(false),
});
export type HackingState = z.infer<typeof HackingStateSchema>;

/** 模型使用：{"type": "npcHack", "id": "placide", "program": "overheat", "target": "你"} */
export const NpcHackCommandSchema = z
  .object({
    type: z.literal("npcHack"),
    id: z.string().min(1).describe("放快速破解的人的卡 id"),
    program: z.string().min(1).describe("程序 id（快速破解表里的）"),
    target: z.string().trim().min(1).max(40).describe("对谁放：对玩家角色写「你」，对别人写称呼"),
  })
  .describe(
    "有卡的人放快速破解：他要装着网络接入仓（义体带程序格的操作系统），代码扣他的 RAM（上限是他义体的 RAM 加起来），不够时拦下；对玩家角色放时，玩家装着自我 ICE 每场先挡下一次。打中玩家的伤害类、终极类要让玩家先掷检定抵抗（智力或肉体），失败再按检定事先写的 damage 写 damage；控制、隐蔽类照效果写",
  );
export type NpcHackCommand = z.infer<typeof NpcHackCommandSchema>;

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
    "潜网：start 躺上潜网椅接进网络（要接入仓、潜网椅和守着肉身的人，战斗中不行），deeper 往下潜一层（本轮智力检定成功才行，深层的检定要事先写明伤害），surface 退出回到肉身；场景结束自动退出",
  );
export type DiveCommand = z.infer<typeof DiveCommandSchema>;
