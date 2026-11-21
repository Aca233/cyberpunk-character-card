import { z } from "zod";

/** 黑话术语：正文里鼠标悬停显示释义 */
export const SlangSchema = z.object({
  term: z.string().min(1),
  /** 别的写法，例如复数、过去式 */
  aliases: z.array(z.string().min(1)).default([]),
  meaning: z.string().min(1),
});
export type Slang = z.input<typeof SlangSchema>;
export const GlossarySchema = z.array(SlangSchema);

/** 转折和两难素材：叙事模型可以取用、改写，不强制套用 */
export const TwistSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["twist", "dilemma"]),
  text: z.string().min(1),
});
export type Twist = z.infer<typeof TwistSchema>;
export const TwistCatalogSchema = z.array(TwistSchema);

/**
 * 2077 夜之城世界时间线的一个节点。
 * 背景大势参考原作设定（basis 写 canon / adapted，source 写出处）；fromDay、toDay 是从开场算的第几天。
 * 玩家不是 V，所有节点仅为无人插手时的世界趋势参考；玩家插手后完全按本局事实改写。
 */
export const CanonNodeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** 阶段序号（从 1 起） */
    order: z.number().int().min(1),
    /** 阶段名（如「四月暗流」「沃森收紧」「权力洗牌」） */
    phase: z.string().min(1),
    title: z.string().min(1),
    fromDay: z.number().int().min(0),
    toDay: z.number().int().min(0),
    where: z.string().min(1),
    /** 街上能听到的：新闻、电台、传言 */
    public: z.string().min(1),
    /** 只给叙事模型的幕后局势 */
    hidden: z.string().min(1),
    /** 玩家可能撞上的自然交集机会 */
    hooks: z.array(z.string().min(1)).min(1),
    basis: z.enum(["canon", "adapted"]),
    source: z.string().min(1),
  })
  .refine((n) => n.toDay >= n.fromDay, { message: "toDay 不能早于 fromDay" });
export type CanonNode = z.input<typeof CanonNodeSchema>;
export const CanonTimelineSchema = z.array(CanonNodeSchema);
