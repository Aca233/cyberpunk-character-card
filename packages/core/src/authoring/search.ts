import { z } from "zod";

/** phrase 使用全文索引；contains 显式进行子串搜索，不自动降级为慢扫描。 */
export const TextSearchRequestSchema = z.strictObject({
  q: z.string().trim().min(2, "检索词至少两个字").max(80),
  scope: z.enum(["onscreen", "subtitle"]).default("onscreen"),
  mode: z.enum(["phrase", "contains"]).default("phrase"),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type TextSearchRequest = z.infer<typeof TextSearchRequestSchema>;

export const TextSourceRequestSchema = z.strictObject({
  key: z.string().trim().min(1).max(512),
});

/** 仅返回短预览，不把本机文本库打包进内容文件。 */
export interface OfficialTextHit {
  readonly rowId: number;
  readonly scope: "onscreen" | "subtitle";
  readonly key: string | null;
  readonly source: string | null;
  readonly category: string | null;
  readonly zh: string;
  readonly en: string;
  readonly truncated: boolean;
}

export interface OfficialTextResult {
  readonly available: boolean;
  readonly mode: "phrase" | "contains" | "source";
  readonly hits: readonly OfficialTextHit[];
  /** 只表示还有结果，不是总命中数。 */
  readonly hasMore: boolean;
  readonly note: string;
}
