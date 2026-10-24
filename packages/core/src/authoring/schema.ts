import { z } from "zod";
import { SlangSchema, TwistSchema } from "../schemas/lore";
import { CyberwareCatalogSchema } from "../systems/cyberware";
import { ItemDefSchema } from "../systems/inventory";
import { JobTemplateSchema } from "../systems/jobs";
import { AffinitySchema, NpcCardSchema } from "../systems/npc";
import { contentPriceIssues } from "./prices";

/** 先开放已有运行时 schema 的条目；时间线和偶遇等对应系统实现后再加入。 */
export const AuthoringKindSchema = z.enum([
  "npc",
  "item",
  "cyberware",
  "jobTemplate",
  "twist",
  "slang",
]);
export type AuthoringKind = z.infer<typeof AuthoringKindSchema>;

export const AUTHORING_LABELS: Readonly<Record<AuthoringKind, string>> = {
  npc: "人物卡",
  item: "物品",
  cyberware: "义体",
  jobTemplate: "委托模板",
  twist: "转折和两难",
  slang: "黑话",
};

export const AUTHORING_SCHEMAS = {
  npc: NpcCardSchema.extend({ affinity: AffinitySchema.shape.delta.optional() }),
  item: ItemDefSchema,
  cyberware: CyberwareCatalogSchema.element,
  jobTemplate: JobTemplateSchema,
  twist: TwistSchema,
  slang: SlangSchema,
} satisfies Record<AuthoringKind, z.ZodType>;

export const NpcReviewKeySchema = z.enum([
  "appearance",
  "voice",
  "story",
  "relationships",
  "knowledge",
]);
export const NPC_REVIEW_ITEMS: readonly {
  readonly id: z.infer<typeof NpcReviewKeySchema>;
  readonly label: string;
}[] = [
  { id: "appearance", label: "外观" },
  { id: "voice", label: "说话方式和口头禅" },
  { id: "story", label: "原剧处境和结局；自创人物核对背景一致性" },
  { id: "relationships", label: "和其他人物的关系" },
  { id: "knowledge", label: "2076 年这个时间点知道什么、不知道什么" },
];

/** 可编辑字段；审核状态、时间、版本由服务端另行管理，不能混在保存请求里。 */
export const AuthoringInputSchema = z.strictObject({
  kind: AuthoringKindSchema,
  content: z.unknown(),
  source: z.array(z.string().trim().min(1).max(500)).max(16).default([]),
  checklist: z.array(NpcReviewKeySchema).max(5).default([]),
});
export type AuthoringInput = z.infer<typeof AuthoringInputSchema>;

export interface AuthoringIssue {
  readonly path: string;
  readonly message: string;
}

const PriceFieldsSchema = z.object({
  name: z.string(),
  kind: z.string().optional(),
  rarity: z.string().optional(),
  price: z.number().optional(),
  iconic: z.boolean().optional(),
});

/** 草稿可以保存原始内容；界面用这些问题标红，审核时必须全部修好。 */
export function validateAuthoringContent(
  kind: AuthoringKind,
  content: unknown,
):
  | { readonly ok: true; readonly content: unknown }
  | { readonly ok: false; readonly issues: readonly AuthoringIssue[] } {
  const parsed = AUTHORING_SCHEMAS[kind].safeParse(content);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: ["content", ...issue.path.map(String)].join("."),
        message: issue.message,
      })),
    };
  }
  if (kind === "item" || kind === "cyberware") {
    const fields = PriceFieldsSchema.parse(parsed.data);
    const issues = contentPriceIssues(kind, fields);
    if (issues.length > 0) {
      return {
        ok: false,
        issues: issues.map((message) => ({ path: "content.price", message })),
      };
    }
  }
  return { ok: true, content: parsed.data };
}

/** 这里只检查审核前提是否齐全，不证明来源真实或原作设定已经核对无误。 */
export function authoringReviewIssues(input: AuthoringInput): AuthoringIssue[] {
  const checked = validateAuthoringContent(input.kind, input.content);
  const issues: AuthoringIssue[] = checked.ok ? [] : [...checked.issues];
  if (!input.source.some((source) => source.trim() !== "")) {
    issues.push({ path: "source", message: "至少填写一个来源；自创内容填写“本作设定”" });
  }
  if (input.kind === "npc") {
    for (const item of NPC_REVIEW_ITEMS) {
      if (!input.checklist.includes(item.id)) {
        issues.push({ path: "checklist", message: `人物卡尚未核对：${item.label}` });
      }
    }
  }
  return issues;
}

/** 本机草稿的持久化外壳；发布时还需检查跨表引用、重复条目和版本冲突。 */
export const AuthoringDraftSchema = AuthoringInputSchema.extend({
  id: z.string().regex(/^a-[a-z0-9-]{1,60}$/),
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(["draft", "reviewed"]),
  reviewedAt: z.string().datetime().nullable(),
}).superRefine((draft, ctx) => {
  if (draft.status === "draft") {
    if (draft.reviewedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewedAt"],
        message: "草稿不能带审核时间",
      });
    }
    return;
  }
  if (draft.reviewedAt === null) {
    ctx.addIssue({
      code: "custom",
      path: ["reviewedAt"],
      message: "已核对条目必须记录审核时间",
    });
  }
  for (const issue of authoringReviewIssues(draft)) {
    ctx.addIssue({
      code: "custom",
      path: issue.path.split("."),
      message: issue.message,
    });
  }
});
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>;
