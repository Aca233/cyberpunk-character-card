import {
  type Clock,
  draftImagePrompt,
  ImagePromptRequestSchema,
  ImageStyleConfigSchema,
} from "@cp/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ConfigService } from "../config";
import type { ImageStore } from "../images";
import { isSaveId } from "../ports";
import { AbortedError, UpstreamError } from "../providers/http";
import type { ImageRouter } from "../providers/image";
import type { LlmRouter } from "../providers/index";

const AspectRatioSchema = z.enum(["1:1", "3:4", "4:3", "16:9", "9:16"]);

const PromptBodySchema = z.object({
  request: ImagePromptRequestSchema,
  useAux: z.boolean().default(true),
  style: ImageStyleConfigSchema.optional(),
});

const BindTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn"),
    seq: z.number().int().min(0),
    imageId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("npc"),
    npcId: z.string().trim().min(1).max(120),
    imageId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("character"),
    imageId: z.string().min(1),
  }),
]);

const UnbindTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("turn"), seq: z.number().int().min(0) }),
  z.object({ kind: z.literal("npc"), npcId: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("character") }),
]);

const GenerateBodySchema = z.object({
  prompt: z.string().trim().min(1, "提示词不能为空").max(4000),
  negativePrompt: z.string().trim().max(2000).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  size: z.string().trim().max(32).optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  profileName: z.string().trim().min(1).optional(),
  bind: z
    .object({
      saveId: z.string().min(1),
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("turn"), seq: z.number().int().min(0) }),
        z.object({ kind: z.literal("npc"), npcId: z.string().trim().min(1).max(120) }),
        z.object({ kind: z.literal("character") }),
      ]),
    })
    .optional(),
});

export function imageRoutes(
  store: ImageStore,
  images: ImageRouter,
  llm: LlmRouter,
  config: ConfigService,
  clock: Clock,
): Hono {
  const app = new Hono();

  app.post("/prompt", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = PromptBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("；") || "参数格式不对" },
        400,
      );
    }
    const auxResolved = parsed.data.useAux ? await llm.resolve("aux") : null;
    const redact = await config.redactor();
    try {
      const result = await draftImagePrompt(auxResolved?.ok ? llm : null, parsed.data.request, {
        useAux: parsed.data.useAux && Boolean(auxResolved?.ok),
        ...(parsed.data.style ? { style: parsed.data.style } : {}),
        signal: c.req.raw.signal,
      });
      if (parsed.data.useAux && auxResolved && !auxResolved.ok && !result.fallbackReason) {
        return c.json({
          ...result,
          fallbackReason: redact(auxResolved.error),
        });
      }
      return c.json({
        ...result,
        ...(result.fallbackReason ? { fallbackReason: redact(result.fallbackReason) } : {}),
      });
    } catch (error) {
      if (error instanceof AbortedError || c.req.raw.signal.aborted) {
        return c.json({ error: "已取消提炼提示词" }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: redact(message) }, 502);
    }
  });

  app.post("/generate", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = GenerateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("；") || "生图参数格式不对" },
        400,
      );
    }
    const data = parsed.data;
    if (data.bind && !isSaveId(data.bind.saveId)) {
      return c.json({ error: "存档 id 不合法" }, 400);
    }
    const redact = await config.redactor();
    try {
      const generated = await images.generate(
        {
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          aspectRatio: data.aspectRatio,
          size: data.size,
          steps: data.steps,
          cfgScale: data.cfgScale,
          seed: data.seed,
        },
        c.req.raw.signal,
        data.profileName,
      );
      const saved = await store.save(
        {
          dataUrl: generated.dataUrl,
          mimeType: generated.mimeType,
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          revisedPrompt: generated.revisedPrompt,
          aspectRatio: data.aspectRatio,
        },
        clock.now(),
      );
      let bindings: Awaited<ReturnType<ImageStore["getBindings"]>> | undefined;
      if (data.bind) {
        const { saveId, target } = data.bind;
        if (target.kind === "turn") {
          bindings = await store.bind(saveId, { kind: "turn", seq: target.seq, imageId: saved.id });
        } else if (target.kind === "npc") {
          bindings = await store.bind(saveId, {
            kind: "npc",
            npcId: target.npcId,
            imageId: saved.id,
          });
        } else {
          bindings = await store.bind(saveId, { kind: "character", imageId: saved.id });
        }
      }
      return c.json({ image: saved, ...(bindings ? { bindings } : {}) });
    } catch (error) {
      if (error instanceof AbortedError || c.req.raw.signal.aborted) {
        return c.json({ error: "已取消生成" }, 400);
      }
      const message =
        error instanceof UpstreamError || error instanceof Error ? error.message : String(error);
      return c.json({ error: redact(message) }, 502);
    }
  });

  app.get("/:id", async (c) => {
    const image = await store.get(c.req.param("id"));
    if (!image) return c.json({ error: "找不到这张图片" }, 404);
    return c.json({ image });
  });

  app.delete("/:id", async (c) => {
    const ok = await store.remove(c.req.param("id"));
    return c.json({ ok });
  });

  return app;
}

export function saveImageRoutes(store: ImageStore): Hono {
  const app = new Hono();

  app.get("/:id/images", async (c) => {
    const saveId = c.req.param("id");
    if (!isSaveId(saveId)) return c.json({ error: "存档 id 不合法" }, 400);
    return c.json({ bindings: await store.getBindings(saveId) });
  });

  app.put("/:id/images", async (c) => {
    const saveId = c.req.param("id");
    if (!isSaveId(saveId)) return c.json({ error: "存档 id 不合法" }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = BindTargetSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "绑定目标格式不对" }, 400);
    }
    const bindings = await store.bind(saveId, parsed.data);
    return c.json({ bindings });
  });

  app.delete("/:id/images", async (c) => {
    const saveId = c.req.param("id");
    if (!isSaveId(saveId)) return c.json({ error: "存档 id 不合法" }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = UnbindTargetSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "解绑目标格式不对" }, 400);
    }
    const bindings = await store.unbind(saveId, parsed.data);
    return c.json({ bindings });
  });

  return app;
}
