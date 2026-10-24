import {
  AUTHORING_LABELS,
  type AuthoringDraft,
  AuthoringInputSchema,
  type Clock,
  NPC_REVIEW_ITEMS,
  validateAuthoringContent,
} from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AuthoringError, type AuthoringStore } from "../authoring";

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

/** 只由 createApp 在开发模式下挂载；尚不包含生成、发布或源码写入接口。 */
export function authoringRoutes(store: AuthoringStore, clock: Clock): Hono {
  const app = new Hono();

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

  return app;
}
