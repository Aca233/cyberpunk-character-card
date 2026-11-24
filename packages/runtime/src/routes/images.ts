import {
  APPEARANCE_HINT_MAX,
  type Clock,
  describeAppearanceFromImage,
  draftImagePrompt,
  IMAGE_NEGATIVE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH,
  ImagePromptRequestSchema,
  ImageStyleConfigSchema,
} from "@cp/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ConfigService } from "../config";
import { ImageBindingError, type ImageStore, MAX_TURN_IMAGES } from "../images";
import { isSaveId } from "../ports";
import { AbortedError, UpstreamError } from "../providers/http";
import { type ImageRouter, imageProtocolCapabilities } from "../providers/image";
import { validateImageDataUrl } from "../providers/image-bytes";
import type { LlmRouter } from "../providers/index";

const AspectRatioSchema = z.enum(["1:1", "3:4", "4:3", "16:9", "9:16"]);

const PromptBodySchema = z.object({
  request: ImagePromptRequestSchema,
  useAux: z.boolean().default(true),
  style: ImageStyleConfigSchema.optional(),
  profileName: z.string().trim().min(1).optional(),
});

const BindTargetSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("turn"),
      seq: z.number().int().min(0),
      imageId: z.string().min(1),
      slot: z
        .number()
        .int()
        .min(0)
        .max(MAX_TURN_IMAGES - 1)
        .optional(),
      append: z.boolean().optional(),
      replaceAll: z.boolean().optional(),
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
  ])
  .and(z.object({ expectedImageId: z.string().min(1).nullable().optional() }));

const UnbindTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn"),
    seq: z.number().int().min(0),
    slot: z
      .number()
      .int()
      .min(0)
      .max(MAX_TURN_IMAGES - 1)
      .optional(),
    imageId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("npc"), npcId: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("character") }),
]);

const GenerateBodySchema = z.strictObject({
  prompt: z.string().trim().min(1, "提示词不能为空").max(IMAGE_PROMPT_MAX_LENGTH),
  negativePrompt: z.string().trim().max(IMAGE_NEGATIVE_PROMPT_MAX_LENGTH).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  size: z.string().trim().max(32).optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  profileName: z.string().trim().min(1).optional(),
});

const UploadBodySchema = z.strictObject({
  dataUrl: z.string().min(1, "图片数据不能为空"),
  label: z.string().trim().max(240).optional(),
});

const DescribeAppearanceBodySchema = z
  .strictObject({
    dataUrl: z.string().min(1).optional(),
    imageId: z.string().trim().min(1).max(160).optional(),
    pronoun: z.string().trim().max(8).optional(),
    hint: z.string().trim().max(APPEARANCE_HINT_MAX).optional(),
    purpose: z.enum(["aux", "narrator"]).optional(),
  })
  .refine((v) => Boolean(v.dataUrl || v.imageId), {
    message: "请先上传图片或指定已有立绘",
  });

function splitDataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

function actualAspectRatio(width: number, height: number): string {
  let left = width;
  let right = height;
  while (right) [left, right] = [right, left % right];
  return `${width / left}:${height / left}`;
}

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
    const imageResolved = await images.resolve(parsed.data.profileName);
    const capabilities = imageResolved.ok
      ? imageProtocolCapabilities(imageResolved.protocol)
      : null;
    const imageModel = {
      profileName: imageResolved.ok ? imageResolved.profile.name : null,
      capabilities,
    };
    const redact = await config.redactor();
    try {
      const result = await draftImagePrompt(auxResolved?.ok ? llm : null, parsed.data.request, {
        useAux: parsed.data.useAux && Boolean(auxResolved?.ok),
        ...(parsed.data.style ? { style: parsed.data.style } : {}),
        negativePromptMode:
          capabilities && !capabilities.negativePrompt ? "in-prompt" : "independent",
        signal: c.req.raw.signal,
      });
      if (parsed.data.useAux && auxResolved && !auxResolved.ok && !result.fallbackReason) {
        return c.json({
          ...result,
          ...imageModel,
          fallbackReason: redact(auxResolved.error),
        });
      }
      return c.json({
        ...result,
        ...imageModel,
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
      if (c.req.raw.signal.aborted) throw new AbortedError();
      const saved = await store.save(
        {
          dataUrl: generated.dataUrl,
          mimeType: generated.mimeType,
          width: generated.width,
          height: generated.height,
          byteLength: generated.byteLength,
          metadata: generated.metadata,
          prompt: data.prompt,
          negativePrompt: data.negativePrompt,
          revisedPrompt: generated.revisedPrompt,
          aspectRatio: actualAspectRatio(generated.width, generated.height),
        },
        clock.now(),
      );
      return c.json({ image: saved });
    } catch (error) {
      if (error instanceof ImageBindingError) return c.json({ error: error.message }, error.status);
      if (error instanceof AbortedError || c.req.raw.signal.aborted) {
        return c.json({ error: "已取消生成" }, 400);
      }
      const message =
        error instanceof UpstreamError || error instanceof Error ? error.message : String(error);
      return c.json(
        { error: redact(message) },
        error instanceof UpstreamError && error.status === 400 ? 400 : 502,
      );
    }
  });

  app.post("/upload", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = UploadBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("；") || "图片上传参数不对" },
        400,
      );
    }
    try {
      const validated = await validateImageDataUrl(parsed.data.dataUrl, c.req.raw.signal);
      if (c.req.raw.signal.aborted) throw new AbortedError();
      const label = parsed.data.label?.trim() || "本地上传图片";
      const saved = await store.save(
        {
          dataUrl: validated.dataUrl,
          mimeType: validated.mimeType,
          width: validated.width,
          height: validated.height,
          byteLength: validated.byteLength,
          metadata: {
            profileName: "local",
            model: "local-upload",
            protocol: "local-upload",
            requestedPrompt: label,
            sentPrompt: label,
          },
          prompt: label,
          aspectRatio: actualAspectRatio(validated.width, validated.height),
        },
        clock.now(),
      );
      return c.json({ image: saved });
    } catch (error) {
      if (error instanceof ImageBindingError) return c.json({ error: error.message }, error.status);
      if (error instanceof AbortedError || c.req.raw.signal.aborted) {
        return c.json({ error: "已取消上传" }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message.replace(/^生成图片校验失败：/, "本地图片校验失败：") }, 400);
    }
  });

  app.post("/describe-appearance", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = DescribeAppearanceBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("；") || "识图参数不对" },
        400,
      );
    }

    const redact = await config.redactor();
    const signal = c.req.raw.signal;

    // 解析识图模型：若前端显式指定 purpose 则按指定；否则优先 aux，aux 未就绪时回退 narrator
    const tryOrder: readonly ("aux" | "narrator")[] = parsed.data.purpose
      ? [parsed.data.purpose]
      : ["aux", "narrator"];
    let chosen:
      | {
          readonly purpose: "aux" | "narrator";
          readonly profileName: string;
          readonly model: string;
        }
      | undefined;
    let firstError = "";
    for (const purpose of tryOrder) {
      const resolved = await llm.resolve(purpose);
      if (resolved.ok) {
        chosen = { purpose, profileName: resolved.profile.name, model: resolved.profile.model };
        break;
      }
      if (!firstError) firstError = resolved.error;
    }
    if (!chosen) {
      return c.json({ error: redact(firstError || "请先在设置页配置支持识图的模型") }, 400);
    }

    let sourceDataUrl = parsed.data.dataUrl;
    if (!sourceDataUrl && parsed.data.imageId) {
      const existing = await store.get(parsed.data.imageId);
      if (!existing) return c.json({ error: "找不到对应的图片，请重新上传" }, 404);
      sourceDataUrl = existing.dataUrl;
    }
    if (!sourceDataUrl) {
      return c.json({ error: "缺少待识别的图片数据" }, 400);
    }

    let validated: Awaited<ReturnType<typeof validateImageDataUrl>>;
    try {
      validated = await validateImageDataUrl(sourceDataUrl, signal);
    } catch (error) {
      if (error instanceof AbortedError || signal.aborted) {
        return c.json({ error: "已取消识图" }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message.replace(/^生成图片校验失败：/, "图片校验失败：") }, 400);
    }

    const base64 = splitDataUrlBase64(validated.dataUrl);
    if (!base64) {
      return c.json({ error: "图片编码异常，请重新上传" }, 400);
    }

    try {
      const result = await describeAppearanceFromImage(
        llm,
        {
          image: { mimeType: validated.mimeType, data: base64 },
          pronoun: parsed.data.pronoun,
          hint: parsed.data.hint,
          purpose: chosen.purpose,
        },
        signal,
      );
      if (!result.ok) {
        return c.json({ error: redact(result.error) }, 502);
      }
      return c.json({
        look: result.look,
        profileName: chosen.profileName,
        model: chosen.model,
        usedPurpose: chosen.purpose,
      });
    } catch (error) {
      if (error instanceof AbortedError || signal.aborted) {
        return c.json({ error: "已取消反推外貌" }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: redact(message) }, 502);
    }
  });

  app.get("/capabilities", async (c) => {
    const profileName = c.req.query("profileName")?.trim() || undefined;
    const resolved = await images.resolve(profileName);
    if (!resolved.ok) {
      const redact = await config.redactor();
      return c.json({
        ready: false,
        error: redact(resolved.error),
        profileName: null,
        capabilities: null,
      });
    }
    return c.json({
      ready: true,
      error: null,
      profileName: resolved.profile.name,
      capabilities: imageProtocolCapabilities(resolved.protocol),
    });
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
    try {
      return c.json({ bindings: await store.getBindings(saveId) });
    } catch (error) {
      if (error instanceof ImageBindingError) return c.json({ error: error.message }, error.status);
      throw error;
    }
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
    try {
      const bindings = await store.bind(saveId, parsed.data, {
        signal: c.req.raw.signal,
      });
      return c.json({ bindings });
    } catch (error) {
      if (error instanceof ImageBindingError) return c.json({ error: error.message }, error.status);
      if (error instanceof AbortedError || c.req.raw.signal.aborted)
        return c.json({ error: "已取消应用图片" }, 400);
      throw error;
    }
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
    try {
      const bindings = await store.unbind(saveId, parsed.data);
      return c.json({ bindings });
    } catch (error) {
      if (error instanceof ImageBindingError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  return app;
}
