import { z } from "zod";
import { KeyedMutex } from "./mutex";
import type { DocStore } from "./ports";

z.config(z.locales.zhCN());

export const ProviderTypeSchema = z.enum(["gemini", "anthropic", "openai", "ollama"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/** 设置页可以修改的字段；名称和类型建好以后不改，密钥走单独的接口 */
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

const ProfileBase = z.strictObject({
  name: z.string().min(1).max(40),
  type: ProviderTypeSchema,
  ...tunables,
  apiKey: z.string().min(1).optional(),
  /** 从环境变量读密钥，例如 GEMINI_API_KEY */
  apiKeyEnv: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "环境变量名只能包含字母、数字和下划线")
    .optional(),
});

export const ProfileSchema = ProfileBase.refine(
  (p) => p.apiKey === undefined || p.apiKeyEnv === undefined,
  { message: "apiKey 和 apiKeyEnv 只能填一个" },
);
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilePatchSchema = z.strictObject(tunables).partial();

/** 设置页新建方案：名字要能放进网址；密钥建好以后另外填 */
export const NewProfileSchema = ProfileBase.omit({ apiKey: true, apiKeyEnv: true }).extend({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "方案名只能用字母、数字、点、下划线和短横线"),
});

const RolesSchema = z.strictObject({
  narrator: z.string().min(1).optional(),
  aux: z.string().min(1).optional(),
});

/** 旧版 config.json 用 gm 记叙事模型的方案：读的时候当成 narrator，下次保存就写成新键 */
function legacyRoles(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("gm" in raw)) return raw;
  const { gm, ...rest } = raw as Record<string, unknown>;
  return "narrator" in rest ? rest : { ...rest, narrator: gm };
}

export const ConfigSchema = z.preprocess(
  legacyRoles,
  z
    .strictObject({
      /** 可以为空：示例配置不带任何连接，玩家自己加；设置页会直接落在「添加连接」表单上 */
      profiles: z.array(ProfileSchema),
      /** 叙事模型（扮演 NPC、写剧情）用哪个方案；还没选就没有这个键 */
      narrator: z.string().min(1).optional(),
      /** 辅助模型（摘要、格式修复、模块解读）用哪个方案 */
      aux: z.string().min(1).optional(),
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
      for (const role of ["narrator", "aux"] as const) {
        const name = config[role];
        if (name !== undefined && !names.has(name)) {
          ctx.addIssue({ code: "custom", path: [role], message: `没有叫 ${name} 的方案` });
        }
      }
    }),
);
export type Config = z.infer<typeof ConfigSchema>;

export type ConfigState =
  | { readonly status: "ok"; readonly config: Config; readonly errors: readonly string[] }
  | { readonly status: "missing" | "invalid"; readonly errors: readonly string[] };

export type KeyStatus = "configured" | "missing" | "notNeeded";
/** 密钥从哪来：config 是存在 config.json 里，env 是从环境变量读到的 */
export type KeySource = "config" | "env" | null;

/** 返回给网页的方案：不含密钥，只说配没配、从哪来 */
export type PublicProfile = Omit<Profile, "apiKey"> & {
  readonly keyStatus: KeyStatus;
  readonly keySource: KeySource;
};

export interface Failure {
  readonly ok: false;
  readonly status: 400 | 404 | 409;
  readonly error: string;
}
export type Result<T> = { readonly ok: true; readonly value: T } | Failure;

function fail(status: Failure["status"], error: string): Failure {
  return { ok: false, status, error };
}

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

/** 校验设置页填的密钥；报错里绝不带上密钥本身 */
function checkKey(raw: unknown): { ok: true; key: string } | Failure {
  if (typeof raw !== "string") return fail(400, "请填写密钥");
  const key = raw.trim();
  if (key.length < 8) return fail(400, "密钥太短，检查是不是没复制完整");
  if (key.length > 1000) return fail(400, "密钥太长，检查是不是多复制了别的内容");
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return fail(400, "密钥里有空格、换行或中文字符，检查是不是多复制了内容");
  }
  return { ok: true, key };
}

type Draft = { readonly draft: unknown } | Failure;

/** 改一个方案；没有这个方案时报 404 */
function withProfile(config: Config, name: string, change: (p: Profile) => unknown): Draft {
  if (!config.profiles.some((p) => p.name === name)) return fail(404, `没有叫 ${name} 的方案`);
  return {
    draft: { ...config, profiles: config.profiles.map((p) => (p.name === name ? change(p) : p)) },
  };
}

/** 示例配置的文件名，和 config.json 放在同一个 DocStore 里 */
const EXAMPLE_FILE = "config.example.json";

/**
 * 模型方案配置。存在哪由 DocStore 决定（文件版放项目根目录的 config.json，纯前端放 IndexedDB）；
 * env 是读密钥的环境变量（服务器传 process.env，浏览器里没有就不传）
 */
export class ConfigService {
  private readonly lock = new KeyedMutex();

  constructor(
    private readonly docs: DocStore,
    readonly file = "config.json",
    private readonly env: Readonly<Record<string, string | undefined>> = {},
  ) {}

  /** 每次都重新读，用户改了 config.json 不用重启 */
  async load(): Promise<ConfigState> {
    const text = await this.docs.read(this.file);
    if (text === undefined) {
      return {
        status: "missing",
        errors: ["还没有模型配置：在设置页点「初始化浏览器配置」"],
      };
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
    const keySource: KeySource =
      key === undefined ? null : profile.apiKey !== undefined ? "config" : "env";
    return { ...rest, keyStatus, keySource };
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
      narrator: config.narrator,
      aux: config.aux,
      profiles: config.profiles.map((p) => this.publicProfile(p)),
    };
  }

  /** 没有 config.json 时照着 config.example.json 建一份；已经有了绝不覆盖 */
  init(): Promise<Result<null>> {
    return this.lock.run("config", async (): Promise<Result<null>> => {
      const state = await this.load();
      if (state.status !== "missing") return fail(409, "config.json 已经存在，不会覆盖");
      let raw: unknown;
      try {
        const text = await this.docs.read(EXAMPLE_FILE);
        if (text === undefined) throw new Error("没有示例配置");
        raw = JSON.parse(text);
      } catch {
        return fail(409, "读不了 config.example.json，没法照着它创建");
      }
      const parsed = ConfigSchema.safeParse(raw);
      if (!parsed.success) return fail(409, "config.example.json 本身格式不对，没法照着它创建");
      await this.docs.write(this.file, `${JSON.stringify(parsed.data, null, 2)}\n`, {
        secret: true,
      });
      return { ok: true, value: null };
    });
  }

  /** 修改一个方案的非密钥字段 */
  updateProfile(name: string, patch: unknown): Promise<Result<PublicProfile>> {
    const parsed = ProfilePatchSchema.safeParse(patch);
    if (!parsed.success) {
      return Promise.resolve(fail(400, formatIssues(parsed.error).join("；")));
    }
    return this.edit(
      (config) => withProfile(config, name, (p) => ({ ...p, ...parsed.data })),
      (config) => this.publicOf(config, name),
    );
  }

  /** 把密钥存进 config.json；原来从环境变量读的，改成用这里填的 */
  setKey(name: string, raw: unknown): Promise<Result<PublicProfile>> {
    const checked = checkKey(raw);
    if (!checked.ok) return Promise.resolve(checked);
    return this.edit(
      (config) =>
        withProfile(config, name, (p) => {
          const { apiKeyEnv: _env, ...rest } = p;
          return { ...rest, apiKey: checked.key };
        }),
      (config) => this.publicOf(config, name),
    );
  }

  /** 删掉存在 config.json 里的密钥；环境变量不归这里管 */
  clearKey(name: string): Promise<Result<PublicProfile>> {
    return this.edit(
      (config) =>
        withProfile(config, name, (p) => {
          const { apiKey: _key, ...rest } = p;
          return rest;
        }),
      (config) => this.publicOf(config, name),
    );
  }

  addProfile(body: unknown): Promise<Result<PublicProfile>> {
    const parsed = NewProfileSchema.safeParse(body);
    if (!parsed.success) {
      return Promise.resolve(fail(400, formatIssues(parsed.error).join("；")));
    }
    const profile = parsed.data;
    return this.edit(
      (config) =>
        config.profiles.some((p) => p.name === profile.name)
          ? fail(409, `已经有叫 ${profile.name} 的方案了`)
          : { draft: { ...config, profiles: [...config.profiles, profile] } },
      (config) => this.publicOf(config, profile.name),
    );
  }

  removeProfile(name: string): Promise<Result<null>> {
    return this.edit(
      (config): Draft => {
        if (!config.profiles.some((p) => p.name === name)) {
          return fail(404, `没有叫 ${name} 的方案`);
        }
        const roles = [
          config.narrator === name ? "叙事模型" : null,
          config.aux === name ? "辅助" : null,
        ]
          .filter((r) => r !== null)
          .join("和");
        if (roles !== "") return fail(409, `「${name}」正在当${roles}，先换成别的方案再删`);
        return { draft: { ...config, profiles: config.profiles.filter((p) => p.name !== name) } };
      },
      () => null,
    );
  }

  /** 换角色 / 辅助用的方案 */
  setRoles(body: unknown): Promise<Result<{ narrator?: string; aux?: string }>> {
    const parsed = RolesSchema.safeParse(body);
    if (!parsed.success) {
      return Promise.resolve(fail(400, formatIssues(parsed.error).join("；")));
    }
    return this.edit(
      (config) => ({ draft: { ...config, ...parsed.data } }),
      (config) => ({
        ...(config.narrator === undefined ? {} : { narrator: config.narrator }),
        ...(config.aux === undefined ? {} : { aux: config.aux }),
      }),
    );
  }

  private publicOf(config: Config, name: string): PublicProfile {
    const profile = config.profiles.find((p) => p.name === name);
    if (!profile) throw new Error("写回后找不到方案");
    return this.publicProfile(profile);
  }

  /** 读出当前配置、改一份、校验整份配置后原子写回；同一时间只有一个修改 */
  private edit<T>(
    apply: (config: Config) => Draft,
    pick: (config: Config) => T,
  ): Promise<Result<T>> {
    return this.lock.run("config", async (): Promise<Result<T>> => {
      const state = await this.load();
      if (state.status !== "ok") return fail(409, "config.json 不存在或格式不对，先修好再改");
      const change = apply(state.config);
      if (!("draft" in change)) return change;
      const next = ConfigSchema.safeParse(change.draft);
      if (!next.success) {
        const secrets = rawSecrets(change.draft);
        return fail(
          400,
          formatIssues(next.error)
            .map((e) => redact(e, secrets))
            .join("；"),
        );
      }
      await this.docs.write(this.file, `${JSON.stringify(next.data, null, 2)}\n`, {
        secret: true,
      });
      return { ok: true, value: pick(next.data) };
    });
  }
}
