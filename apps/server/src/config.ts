import { readFile } from "node:fs/promises";
import { z } from "zod";
import { atomicWrite, isNotFound, KeyedMutex } from "./fsutil";

z.config(z.locales.zhCN());

export const ProviderTypeSchema = z.enum(["gemini", "anthropic", "openai", "ollama"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/** 设置页可以修改的字段；密钥、类型和名称只能直接改 config.json */
const tunables = {
  baseUrl: z.url().optional(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).optional(),
  /** 上下文窗口（token），上下文预算按它分配 */
  contextWindow: z.number().int().min(4096),
  /** Gemini 3 系列的思考强度 */
  thinkingLevel: z.enum(["low", "medium", "high"]).optional(),
  /** off：不传安全设置（3.x 默认即关闭）；blockNone：不拦截但返回评分 */
  safety: z.enum(["off", "blockNone"]).optional(),
  embeddingModel: z.string().min(1).optional(),
};

export const ProfileSchema = z
  .strictObject({
    name: z.string().min(1).max(40),
    type: ProviderTypeSchema,
    ...tunables,
    apiKey: z.string().min(1).optional(),
    /** 从环境变量读密钥，例如 GEMINI_API_KEY */
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "环境变量名只能包含字母、数字和下划线")
      .optional(),
  })
  .refine((p) => p.apiKey === undefined || p.apiKeyEnv === undefined, {
    message: "apiKey 和 apiKeyEnv 只能填一个",
  });
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilePatchSchema = z.strictObject(tunables).partial();

export const ConfigSchema = z
  .strictObject({
    profiles: z.array(ProfileSchema).min(1, "至少要有一个方案"),
    /** 主持人模型用哪个方案 */
    gm: z.string().min(1),
    /** 辅助模型（摘要、格式修复、模块解读）用哪个方案 */
    aux: z.string().min(1),
  })
  .superRefine((config, ctx) => {
    const names = new Set<string>();
    for (const [index, profile] of config.profiles.entries()) {
      if (names.has(profile.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["profiles", index, "name"],
          message: `方案名重复：${profile.name}`,
        });
      }
      names.add(profile.name);
    }
    for (const role of ["gm", "aux"] as const) {
      if (!names.has(config[role])) {
        ctx.addIssue({ code: "custom", path: [role], message: `没有叫 ${config[role]} 的方案` });
      }
    }
  });
export type Config = z.infer<typeof ConfigSchema>;

export type ConfigState =
  | { readonly status: "ok"; readonly config: Config; readonly errors: readonly string[] }
  | { readonly status: "missing" | "invalid"; readonly errors: readonly string[] };

export type KeyStatus = "configured" | "missing" | "notNeeded";

/** 返回给网页的方案：不含密钥，只说配没配 */
export type PublicProfile = Omit<Profile, "apiKey"> & { readonly keyStatus: KeyStatus };

export type UpdateResult =
  | { readonly ok: true; readonly profile: PublicProfile }
  | { readonly ok: false; readonly status: 400 | 404 | 409; readonly error: string };

export const HIDDEN = "[已隐藏]";

/** 把文本里出现的密钥换成占位符；日志、报错、接口返回都先过一遍 */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) out = out.split(secret).join(HIDDEN);
  }
  return out;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "（整个文件）";
    return `${path}：${issue.message}`;
  });
}

/** 配置文件格式不对时，从原始内容里尽量找出密钥，避免出现在报错里 */
function rawSecrets(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const profiles = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) return [];
  return profiles
    .map((p) => (typeof p === "object" && p !== null ? (p as { apiKey?: unknown }).apiKey : null))
    .filter((k): k is string => typeof k === "string");
}

export class ConfigService {
  private readonly lock = new KeyedMutex();

  constructor(
    readonly path: string,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  /** 每次都从磁盘读，用户改了 config.json 不用重启 */
  async load(): Promise<ConfigState> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return {
          status: "missing",
          errors: ["没有找到 config.json：把 config.example.json 复制为 config.json 后填写"],
        };
      }
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // 不带上 JSON.parse 的原始报错：它会引用文件内容，可能包含密钥
      return { status: "invalid", errors: ["config.json 不是合法的 JSON，检查逗号、引号和括号"] };
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const secrets = rawSecrets(raw);
      return {
        status: "invalid",
        errors: formatIssues(parsed.error).map((e) => redact(e, secrets)),
      };
    }
    return { status: "ok", config: parsed.data, errors: [] };
  }

  keyFor(profile: Profile): string | undefined {
    const key =
      profile.apiKey ?? (profile.apiKeyEnv === undefined ? undefined : this.env[profile.apiKeyEnv]);
    return key === undefined || key === "" ? undefined : key;
  }

  publicProfile(profile: Profile): PublicProfile {
    const { apiKey: _hidden, ...rest } = profile;
    const key = this.keyFor(profile);
    const keyStatus: KeyStatus =
      key !== undefined ? "configured" : profile.type === "ollama" ? "notNeeded" : "missing";
    return { ...rest, keyStatus };
  }

  /** 当前配置里能解析出的所有密钥 */
  async secrets(): Promise<string[]> {
    const state = await this.load();
    if (state.status !== "ok") return [];
    return state.config.profiles.flatMap((p) => this.keyFor(p) ?? []);
  }

  async redactor(): Promise<(text: string) => string> {
    const secrets = await this.secrets();
    return (text) => redact(text, secrets);
  }

  async overview() {
    const state = await this.load();
    if (state.status !== "ok") {
      return { status: state.status, errors: state.errors, profiles: [] as PublicProfile[] };
    }
    const { config } = state;
    return {
      status: state.status,
      errors: state.errors,
      gm: config.gm,
      aux: config.aux,
      profiles: config.profiles.map((p) => this.publicProfile(p)),
    };
  }

  /** 修改一个方案的非密钥字段，校验整份配置后原子写回 */
  updateProfile(name: string, patch: unknown): Promise<UpdateResult> {
    return this.lock.run("config", async (): Promise<UpdateResult> => {
      const state = await this.load();
      if (state.status !== "ok") {
        return { ok: false, status: 409, error: "config.json 不存在或格式不对，先修好再改" };
      }
      const parsedPatch = ProfilePatchSchema.safeParse(patch);
      if (!parsedPatch.success) {
        return { ok: false, status: 400, error: formatIssues(parsedPatch.error).join("；") };
      }
      const { config } = state;
      if (!config.profiles.some((p) => p.name === name)) {
        return { ok: false, status: 404, error: `没有叫 ${name} 的方案` };
      }
      const next = ConfigSchema.safeParse({
        ...config,
        profiles: config.profiles.map((p) => (p.name === name ? { ...p, ...parsedPatch.data } : p)),
      });
      if (!next.success) {
        return { ok: false, status: 400, error: formatIssues(next.error).join("；") };
      }
      await atomicWrite(this.path, `${JSON.stringify(next.data, null, 2)}\n`);
      const profile = next.data.profiles.find((p) => p.name === name);
      if (!profile) throw new Error("写回后找不到方案");
      return { ok: true, profile: this.publicProfile(profile) };
    });
  }
}
