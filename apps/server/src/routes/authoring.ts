import { cyberware, glossary, items, jobTemplates, npcs, twists } from "@cp/content";
import {
  AUTHORING_LABELS,
  type AuthoringDraft,
  AuthoringGenerateRequestSchema,
  AuthoringInputSchema,
  type AuthoringKind,
  type Clock,
  generateAuthoringDraft,
  type LlmClient,
  NPC_REVIEW_ITEMS,
  type OfficialTextResult,
  TextSearchRequestSchema,
  TextSourceRequestSchema,
  validateAuthoringContent,
} from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AuthoringError, type AuthoringStore } from "../authoring";
import { type AuthoringTextSearch, OfficialTextError } from "../authoring-search";
import { AbortedError, UpstreamError } from "../providers/http";

/** 起草时给模型看的格式示例：各类取内容包里的第一条 */
const EXAMPLES: Readonly<Record<AuthoringKind, unknown>> = {
  npc: npcs[0],
  item: items[0],
  cyberware: cyberware[0],
  jobTemplate: jobTemplates[0],
  twist: twists[0],
  slang: glossary[0],
};

const UpdateSchema = z.strictObject({
  revision: z.number().int().min(1),
  input: AuthoringInputSchema,
});

const ReviewSchema = z.strictObject({
  revision: z.number().int().min(1),
  /** 用户明确完成核对后提交；普通保存和模型输出均不能设置审核状态。 */
  confirm: z.literal(true),
});

async function bodyOf<T>(c: Context, schema: z.ZodType<T>) {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: "请求体不是合法的 JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true as const, value: parsed.data }
    : {
        ok: false as const,
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "请求"}：${issue.message}`)
          .join("；"),
      };
}

async function draftResponse(
  c: Context,
  operation: () => Promise<AuthoringDraft>,
  status: 200 | 201 = 200,
) {
  try {
    const draft = await operation();
    return c.json(
      { draft, validation: validateAuthoringContent(draft.kind, draft.content) },
      status,
    );
  } catch (error) {
    if (error instanceof AuthoringError) {
      return c.json({ error: error.message, issues: error.issues }, error.status);
    }
    throw error;
  }
}

/** 只由 createApp 在开发模式下挂载；尚不包含发布或源码写入接口。 */
function textResponse(c: Context, operation: () => OfficialTextResult) {
  try {
    return c.json(operation());
  } catch (error) {
    if (error instanceof OfficialTextError) return c.json({ error: error.message }, 503);
    throw error;
  }
}

export function authoringRoutes(
  store: AuthoringStore,
  clock: Clock,
  text?: AuthoringTextSearch,
  llm?: LlmClient,
): Hono {
  const app = new Hono();

  app.get("/text/search", (c) => {
    const input = TextSearchRequestSchema.safeParse(c.req.query());
    if (!input.success)
      return c.json({ error: "检索参数不合法：关键词 2–80 字，最多返回 20 条" }, 400);
    if (!text)
      return c.json({
        available: false,
        mode: input.data.mode,
        hits: [],
        hasMore: false,
        note: "本机尚未配置官方文本检索，可以继续手工填写来源",
      });
    return textResponse(c, () => text.search(input.data));
  });

  app.get("/text/source", (c) => {
    const input = TextSourceRequestSchema.safeParse(c.req.query());
    if (!input.success) return c.json({ error: "来源键不合法" }, 400);
    if (!text)
      return c.json({
        available: false,
        mode: "source",
        hits: [],
        hasMore: false,
        note: "本机尚未配置官方文本检索",
      });
    return textResponse(c, () => text.source(input.data.key));
  });

  app.get("/types", (c) => c.json({ kinds: AUTHORING_LABELS, npcChecklist: NPC_REVIEW_ITEMS }));

  app.get("/drafts", async (c) => {
    try {
      return c.json({ drafts: await store.list() });
    } catch (error) {
      if (error instanceof AuthoringError) {
        return c.json({ error: error.message, issues: error.issues }, error.status);
      }
      throw error;
    }
  });

  app.get("/drafts/:id", (c) =>
    draftResponse(c, async () => {
      const draft = await store.get(c.req.param("id"));
      if (!draft) throw new AuthoringError(404, "没有这份草稿");
      return draft;
    }),
  );

  app.post("/drafts", async (c) => {
    const body = await bodyOf(c, AuthoringInputSchema);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return draftResponse(c, () => store.create(body.value, clock.now()), 201);
  });

  app.put("/drafts/:id", async (c) => {
    const body = await bodyOf(c, UpdateSchema);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return draftResponse(c, () =>
      store.update(c.req.param("id"), body.value.revision, body.value.input, clock.now()),
    );
  });

  app.post("/drafts/:id/review", async (c) => {
    const body = await bodyOf(c, ReviewSchema);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return draftResponse(c, () =>
      store.review(c.req.param("id"), body.value.revision, clock.now()),
    );
  });

  // 辅助模型起草：只返回初稿给页面，不保存；保存仍走 /drafts，来源和审核由人工填
  app.post("/generate", async (c) => {
    const body = await bodyOf(c, AuthoringGenerateRequestSchema);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (!llm) return c.json({ error: "没有接上辅助模型" }, 503);
    try {
      const result = await generateAuthoringDraft(
        llm,
        body.value,
        EXAMPLES[body.value.kind],
        c.req.raw.signal,
      );
      return result.ok ? c.json(result.result) : c.json({ error: result.error }, 502);
    } catch (error) {
      if (error instanceof AbortedError) return c.json({ error: "已停止起草" }, 400);
      if (error instanceof UpstreamError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });

  return app;
}
