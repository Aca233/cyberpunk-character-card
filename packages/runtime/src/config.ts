import { z } from "zod";
import { KeyedMutex } from "./mutex";
import type { DocStore } from "./ports";

z.config(z.locales.zhCN());

export const ProviderTypeSchema = z.enum([
  "gemini",
  "vertex",
  "anthropic",
  "openai",
  "ollama",
  "sdwebui",
  "comfyui",
  "novelai",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ImageProtocolSchema = z.enum([
  "auto",
  "openai-images",
  "openai-chat",
  "gemini-native",
  "gemini-imagen",
  "sdwebui",
  "comfyui",
  "novelai",
  "wavespeed",
]);
export type ImageProtocol = z.infer<typeof ImageProtocolSchema>;

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
  /** 文生图协议（设为文生图模型时生效）；auto 按提供方与模型名自动识别 */
  imageProtocol: ImageProtocolSchema.optional(),
  /** ComfyUI 自定义 API 工作流模板 JSON（可选，留空用内置文生图工作流） */
  comfyWorkflow: z.string().max(100_000).optional(),
  /** 提示缓存协议模式：auto 按官方/已知端点自动启用，on 显式开启（含 Gemini/Vertex cachedContents 与中转站透传），off 关闭显式标记 */
  promptCacheMode: z.enum(["auto", "on", "off"]).optional(),
  /** 提示缓存保留时长：Anthropic 支持 5m/1h，OpenAI 官方支持 24h，Gemini 显式缓存支持 30m(default)/1h */
  cacheTtl: z.enum(["default", "5m", "1h", "24h"]).optional(),
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

export const ProfilePatchSchema = z
  .strictObject({
    ...tunables,
    /** 传 null 表示清空已保存的温度 / 输出上限 / 思考强度 / 附挂向量模型 */
    temperature: z.number().min(0).max(2).nullable().optional(),
    maxOutputTokens: z.number().int().min(1).nullable().optional(),
    thinkingLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
    embeddingModel: z.string().min(1).nullable().optional(),
  })
  .partial();

/** 设置页新建方案：名字要能放进网址；密钥建好以后另外填，或由 copyKeyFrom 在本地直接复制原连接密钥 */
export const NewProfileSchema = ProfileBase.omit({ apiKey: true, apiKeyEnv: true }).extend({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "方案名只能用字母、数字、点、下划线和短横线"),
  /** 复制已有连接时，在本地运行时直接继承其 apiKey / apiKeyEnv，不向前端回传密钥 */
  copyKeyFrom: z.string().min(1).max(40).optional(),
});

export type RoleKey = "narrator" | "aux" | "image" | "embedding" | "reranker";
const ROLE_KEYS: readonly RoleKey[] = ["narrator", "aux", "image", "embedding", "reranker"];

const RoleModelsSchema = z
  .strictObject({
    narrator: z.string().trim().min(1).optional(),
    aux: z.string().trim().min(1).optional(),
    image: z.string().trim().min(1).optional(),
    embedding: z.string().trim().min(1).optional(),
    reranker: z.string().trim().min(1).optional(),
  })
  .optional();
export type RoleModels = NonNullable<z.infer<typeof RoleModelsSchema>>;

const RoleModelsPatchSchema = z
  .strictObject({
    narrator: z.string().trim().nullable().optional(),
    aux: z.string().trim().nullable().optional(),
    image: z.string().trim().nullable().optional(),
    embedding: z.string().trim().nullable().optional(),
    reranker: z.string().trim().nullable().optional(),
  })
  .optional();

const RolesSchema = z.strictObject({
  narrator: z.string().min(1).optional(),
  aux: z.string().min(1).optional(),
  /** 传 null 表示停用/卸载文生图模型 */
  image: z.string().min(1).nullable().optional(),
  /** 传 null 表示停用独立向量模型（回退到对话方案附挂或规则检索） */
  embedding: z.string().min(1).nullable().optional(),
  /** 传 null 表示停用语义重排模型 */
  reranker: z.string().min(1).nullable().optional(),
  /** 按角色独立指定模型 ID，让同一个中转站连接同时承担多个不同模型，无需重复建连接 */
  roleModels: RoleModelsPatchSchema,
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
      /** 文生图模型（角色立绘、NPC 肖像、回合场景插图）用哪个方案 */
      image: z.string().min(1).optional(),
      /** 独立向量嵌入模型（旧记忆语义检索）用哪个方案 */
      embedding: z.string().min(1).optional(),
      /** 语义重排模型（Reranker，用于二阶段记忆精排）用哪个方案 */
      reranker: z.string().min(1).optional(),
      /** 各角色独立模型覆写（同一中转站连接可同时分配不同模型） */
      roleModels: RoleModelsSchema,
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
      for (const role of ["narrator", "aux", "image", "embedding", "reranker"] as const) {
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
  // 以 { 开头的是 Vertex 服务账号 JSON（压成单行约 2.4KB），普通 API key 不会这么长
  if (key.startsWith("{")) {
    if (key.length > 8000) return fail(400, "密钥太长，检查是不是多复制了别的内容");
    // JSON 内部允许空格和非 ASCII 字符；只要求能解析且是单行
    if (/[\r\n]/.test(key)) return fail(400, "服务账号 JSON 必须压成单行，请重新导入 JSON 文件");
    try {
      JSON.parse(key);
    } catch {
      return fail(400, "密钥以 { 开头但不是合法 JSON，请重新导入服务账号 JSON 文件");
    }
    return { ok: true, key };
  }
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
    const localNoKey =
      profile.type === "ollama" || profile.type === "sdwebui" || profile.type === "comfyui";
    const keyStatus: KeyStatus =
      key !== undefined ? "configured" : localNoKey ? "notNeeded" : "missing";
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
      image: config.image,
      embedding: config.embedding,
      reranker: config.reranker,
      ...(config.roleModels && Object.keys(config.roleModels).length > 0
        ? { roleModels: config.roleModels }
        : {}),
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
      (config) =>
        withProfile(config, name, (p) => {
          const { embeddingModel, temperature, maxOutputTokens, thinkingLevel, ...rest } =
            parsed.data;
          const next: Record<string, unknown> = { ...p, ...rest };
          if (embeddingModel === null) delete next.embeddingModel;
          else if (embeddingModel !== undefined) next.embeddingModel = embeddingModel;
          if (temperature === null) delete next.temperature;
          else if (temperature !== undefined) next.temperature = temperature;
          if (maxOutputTokens === null) delete next.maxOutputTokens;
          else if (maxOutputTokens !== undefined) next.maxOutputTokens = maxOutputTokens;
          if (thinkingLevel === null) delete next.thinkingLevel;
          else if (thinkingLevel !== undefined) next.thinkingLevel = thinkingLevel;
          return next;
        }),
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
    const { copyKeyFrom, ...profile } = parsed.data;
    return this.edit(
      (config) => {
        if (config.profiles.some((p) => p.name === profile.name)) {
          return fail(409, `已经有叫 ${profile.name} 的方案了`);
        }
        let keyFields: { apiKey?: string; apiKeyEnv?: string } = {};
        if (copyKeyFrom !== undefined) {
          const source = config.profiles.find((p) => p.name === copyKeyFrom);
          if (!source) return fail(404, `找不到要复制密钥的连接「${copyKeyFrom}」`);
          if (source.apiKey !== undefined) keyFields = { apiKey: source.apiKey };
          else if (source.apiKeyEnv !== undefined) keyFields = { apiKeyEnv: source.apiKeyEnv };
        }
        return {
          draft: { ...config, profiles: [...config.profiles, { ...profile, ...keyFields }] },
        };
      },
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
          config.image === name ? "文生图" : null,
          config.embedding === name ? "向量模型" : null,
          config.reranker === name ? "重排模型" : null,
        ]
          .filter((r) => r !== null)
          .join("和");
        if (roles !== "") {
          const onlyOptional =
            config.narrator !== name &&
            config.aux !== name &&
            (config.image === name || config.embedding === name || config.reranker === name);
          const hint = onlyOptional ? "先停用该可选模型或换成别的方案再删" : "先换成别的方案再删";
          return fail(409, `「${name}」正在当${roles}，${hint}`);
        }
        return { draft: { ...config, profiles: config.profiles.filter((p) => p.name !== name) } };
      },
      () => null,
    );
  }

  /** 换角色 / 辅助 / 文生图 / 向量检索 / 语义重排用的方案及各角色独立模型覆写 */
  setRoles(body: unknown): Promise<
    Result<{
      narrator?: string;
      aux?: string;
      image?: string;
      embedding?: string;
      reranker?: string;
      roleModels?: RoleModels;
    }>
  > {
    const parsed = RolesSchema.safeParse(body);
    if (!parsed.success) {
      return Promise.resolve(fail(400, formatIssues(parsed.error).join("；")));
    }
    return this.edit(
      (config) => {
        const { image, embedding, reranker, roleModels: roleModelsPatch, ...rest } = parsed.data;
        const next: Record<string, unknown> = { ...config, ...rest };
        if (image === null) delete next.image;
        else if (image !== undefined) next.image = image;
        if (embedding === null) delete next.embedding;
        else if (embedding !== undefined) next.embedding = embedding;
        if (reranker === null) delete next.reranker;
        else if (reranker !== undefined) next.reranker = reranker;

        const nextRoleModels: Record<string, string> = {};
        if (config.roleModels) {
          for (const role of ROLE_KEYS) {
            const existingModel = config.roleModels[role];
            if (existingModel !== undefined) nextRoleModels[role] = existingModel;
          }
        }
        for (const role of ROLE_KEYS) {
          const prevProfile = config[role];
          const nextProfile = typeof next[role] === "string" ? (next[role] as string) : undefined;
          const patchVal = roleModelsPatch?.[role];
          if (nextProfile === undefined) {
            delete nextRoleModels[role];
            continue;
          }
          if (patchVal !== undefined) {
            const trimmed = patchVal === null ? "" : patchVal.trim();
            const bound = config.profiles.find((p) => p.name === nextProfile);
            if (!trimmed || (bound && trimmed === bound.model)) {
              delete nextRoleModels[role];
            } else {
              nextRoleModels[role] = trimmed;
            }
          } else if (prevProfile !== nextProfile) {
            // 切换到另一条连接且未指定新覆写模型时，清除旧连接的残留覆写
            delete nextRoleModels[role];
          }
        }
        if (Object.keys(nextRoleModels).length > 0) next.roleModels = nextRoleModels;
        else delete next.roleModels;

        return { draft: next };
      },
      (config) => ({
        ...(config.narrator === undefined ? {} : { narrator: config.narrator }),
        ...(config.aux === undefined ? {} : { aux: config.aux }),
        ...(config.image === undefined ? {} : { image: config.image }),
        ...(config.embedding === undefined ? {} : { embedding: config.embedding }),
        ...(config.reranker === undefined ? {} : { reranker: config.reranker }),
        ...(config.roleModels && Object.keys(config.roleModels).length > 0
          ? { roleModels: config.roleModels }
          : {}),
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
