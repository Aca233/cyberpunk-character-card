import { z } from "zod";
import { AttributeSchema } from "../dice";
import { RaritySchema } from "../economy";

/** 义体部位，按原作分类；同一部位只装一件 */
export const CYBERWARE_SLOTS = [
  "frontalCortex",
  "eyes",
  "nervous",
  "os",
  "circulatory",
  "integumentary",
  "skeleton",
  "hands",
  "arms",
  "legs",
] as const;
export const CyberwareSlotSchema = z.enum(CYBERWARE_SLOTS);
export type CyberwareSlot = z.infer<typeof CyberwareSlotSchema>;

export const SLOT_LABELS: Readonly<Record<CyberwareSlot, string>> = {
  frontalCortex: "额叶皮质",
  eyes: "眼部",
  nervous: "神经系统",
  os: "操作系统",
  circulatory: "循环系统",
  integumentary: "皮肤",
  skeleton: "骨骼",
  hands: "手部",
  arms: "手臂",
  legs: "腿部",
};

/** 义体表的一条；数据在 content 包的 cyberware.ts */
export const CyberwareDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  slot: CyberwareSlotSchema,
  rarity: RaritySchema,
  /** 义体医生的参考价，含安装费 */
  price: z.number().int().min(0),
  /** 装着时人性上限降低多少 */
  humanityCost: z.number().int().min(0).max(20),
  /** 装上后角色真的能做到什么；写给模型，也显示在侧栏 */
  ability: z.string().min(1),
  /** 做哪些属性的检定时算有利条件 */
  checks: z.array(AttributeSchema).default([]),
  /** 不朽义体（原作的 Iconic；军用级、原型）：只从剧情获得，义体医生不卖 */
  iconic: z.boolean().default(false),
});
export type CyberwareDef = z.infer<typeof CyberwareDefSchema>;

export const CyberwareCatalogSchema = z.array(CyberwareDefSchema);

export const CyberwareStateSchema = z.object({
  installed: z
    .array(
      z.object({
        id: z.string().min(1),
        slot: CyberwareSlotSchema,
        /** 装上时的游戏时间（分钟） */
        installedAt: z.number().int(),
      }),
    )
    .default([]),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()).default([]),
});
export type CyberwareState = z.infer<typeof CyberwareStateSchema>;

/** 模型使用：义体医生装、卸义体 */
export const CyberwareCommandSchema = z
  .object({
    type: z.literal("cyberware"),
    action: z.enum(["install", "remove"]),
    id: z.string().min(1),
    /** 不写时按义体表的价钱；谈下来的价或剧情白送时写，白送写 0 */
    price: z.number().int().min(0).max(200_000).optional(),
    reason: z.string().min(1),
    /** 事件 id；带上后同一事件只结算一次 */
    event: z.string().min(1).optional(),
  })
  .describe(
    "义体医生装、卸义体：install 按义体表扣欧元（谈下来的价或白送时写 price，白送写 0），余额不够时整条不生效；同一部位只装一件，装新的换下旧的；remove 卸下。人性上限由代码算，不另写 humanity",
  );
export type CyberwareCommand = z.infer<typeof CyberwareCommandSchema>;

/** 只能由代码发出：开局自带的义体，不扣钱 */
export const InstallCyberwareSchema = z.object({
  type: z.literal("cyberware.install"),
  id: z.string().min(1),
});
export type InstallCyberware = z.infer<typeof InstallCyberwareSchema>;
