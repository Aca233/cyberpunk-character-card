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

/** 转折和两难素材：主持人可以取用、改写，不强制套用 */
export const TwistSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["twist", "dilemma"]),
  text: z.string().min(1),
});
export type Twist = z.infer<typeof TwistSchema>;
export const TwistCatalogSchema = z.array(TwistSchema);
