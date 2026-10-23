import type { ActionRequest, CharacterCard, PlayerView, TurnInput, TurnUsage } from "@cp/core";

/** 后端接口；只走同源的 /api（开发时由 Vite 转给 127.0.0.1 上的后端），网页里没有任何密钥 */

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    /** 0 表示连不上后端 */
    readonly status: number,
    readonly body: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("连不上后端：确认已经在项目根目录运行 pnpm --filter @cp/server dev", 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw new ApiError(`后端返回了 ${response.status}，内容不是 JSON`, response.status);
    }
  }
  if (!response.ok) {
    const details = Array.isArray(data.details) ? `：${data.details.join("；")}` : "";
    const message = typeof data.error === "string" ? data.error : `请求失败（${response.status}）`;
    throw new ApiError(`${message}${details}`, response.status, data);
  }
  return data as T;
}

export interface Health {
  readonly ok: boolean;
  readonly config: "ok" | "missing" | "invalid";
  readonly dev: boolean;
  /** 仅检查本机配置，不代表已经连通过服务商。兼容旧后端。 */
  readonly models?: {
    readonly ready: boolean;
    readonly gm: { readonly ready: boolean; readonly error: string | null };
    readonly aux: { readonly ready: boolean; readonly error: string | null };
  };
}

export type Difficulty = PlayerView["difficulty"];

export interface SaveSummary {
  readonly id: string;
  readonly title: string;
  readonly characterId: string;
  readonly difficulty: Difficulty;
  readonly createdAt: string;
  readonly startTime: number;
  readonly running: boolean;
}

/** 角色卡：sample 是内容包里的示例，只读 */
export interface CharacterEntry {
  readonly id: string;
  readonly updatedAt: string;
  readonly card: CharacterCard;
  readonly sample: boolean;
}

export type KeyStatus = "configured" | "missing" | "notNeeded";

/** 后端返回的方案：不含密钥，只说配没配 */
export interface PublicProfile {
  readonly name: string;
  readonly type: "gemini" | "anthropic" | "openai" | "ollama";
  readonly baseUrl?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly contextWindow: number;
  readonly thinkingLevel?: "low" | "medium" | "high";
  readonly safety?: "off" | "blockNone";
  readonly embeddingModel?: string;
  readonly apiKeyEnv?: string;
  readonly keyStatus: KeyStatus;
  /** 密钥从哪来：config.json、环境变量，或者还没有 */
  readonly keySource: "config" | "env" | null;
}

export interface ProfilesOverview {
  readonly status: "ok" | "missing" | "invalid";
  readonly errors: readonly string[];
  readonly gm?: string;
  readonly aux?: string;
  readonly profiles: readonly PublicProfile[];
}

export interface ProfilePatch {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
}

/** 新建方案；密钥另外用 setKey 存 */
export interface NewProfile {
  name: string;
  type: PublicProfile["type"];
  model: string;
  baseUrl?: string;
  contextWindow: number;
}

export type ConnectionTest =
  | {
      readonly ok: true;
      readonly model: string;
      readonly ms: number;
      readonly reply: string;
      readonly usage?: TurnUsage;
    }
  | { readonly ok: false; readonly error: string; readonly ms?: number };

export type SubmitResult =
  | { readonly kind: "started"; readonly turnId: string }
  | { readonly kind: "duplicate"; readonly seq: number; readonly version: number };

export interface TurnContext {
  readonly seq: number;
  readonly at: string;
  readonly input: TurnInput | null;
  readonly text: string;
  readonly read: string | null;
  readonly modules: readonly string[];
  readonly commands: readonly unknown[];
  readonly dropped: readonly unknown[];
  readonly notes: readonly string[];
  readonly check: unknown;
  readonly choices: readonly unknown[];
  readonly dice: readonly unknown[];
  readonly resolves: string | null;
  readonly usage: TurnUsage | null;
  readonly totalUsage: TurnUsage & { readonly turns: number };
  readonly prompt: {
    readonly messages: readonly { readonly role: string; readonly content: string }[];
    readonly modules: readonly string[];
  } | null;
  readonly rebuildError: string | null;
}

export type TurnBody = { requestId: string; baseVersion: number } & (
  | { input: TurnInput }
  | { confirm: string }
);

export const api = {
  health: () => request<Health>("GET", "/health"),
  profiles: () => request<ProfilesOverview>("GET", "/profiles"),
  updateProfile: (name: string, patch: ProfilePatch) =>
    request<{ profile: PublicProfile }>("PUT", `/profiles/${encodeURIComponent(name)}`, patch),
  /** 会用这个方案发一条很短的请求，产生极少量费用 */
  testProfile: (name: string) =>
    request<ConnectionTest>("POST", `/profiles/${encodeURIComponent(name)}/test`),
  /** 照 config.example.json 建一份 config.json（已有就不动） */
  initConfig: () => request<{ ok: true }>("POST", "/profiles/-/init"),
  setRoles: (roles: { gm?: string; aux?: string }) =>
    request<{ gm: string; aux: string }>("PUT", "/profiles/-/roles", roles),
  createProfile: (profile: NewProfile) =>
    request<{ profile: PublicProfile }>("POST", "/profiles", profile),
  deleteProfile: (name: string) =>
    request<{ ok: true }>("DELETE", `/profiles/${encodeURIComponent(name)}`),
  /** 密钥只发给本机后端，后端不会再把它返回 */
  setKey: (name: string, apiKey: string) =>
    request<{ profile: PublicProfile }>("PUT", `/profiles/${encodeURIComponent(name)}/key`, {
      apiKey,
    }),
  clearKey: (name: string) =>
    request<{ profile: PublicProfile }>("DELETE", `/profiles/${encodeURIComponent(name)}/key`),
  characters: () =>
    request<{ characters: CharacterEntry[] }>("GET", "/characters").then((r) => r.characters),
  createCharacter: (card: CharacterCard) =>
    request<{ character: CharacterEntry }>("POST", "/characters", card).then((r) => r.character),
  updateCharacter: (id: string, card: CharacterCard) =>
    request<{ character: CharacterEntry }>("PUT", `/characters/${id}`, card).then(
      (r) => r.character,
    ),
  deleteCharacter: (id: string) => request<{ ok: true }>("DELETE", `/characters/${id}`),
  saves: () => request<{ saves: SaveSummary[] }>("GET", "/saves").then((r) => r.saves),
  createSave: (input: { title: string; characterId: string; difficulty: Difficulty }) =>
    request<SaveSummary>("POST", "/saves", input),
  state: (saveId: string) => request<PlayerView>("GET", `/saves/${saveId}/state`),
  async submit(saveId: string, body: TurnBody): Promise<SubmitResult> {
    const r = await request<Record<string, unknown>>("POST", `/saves/${saveId}/turns`, body);
    if (typeof r.turnId === "string") return { kind: "started", turnId: r.turnId };
    return { kind: "duplicate", seq: Number(r.seq), version: Number(r.version) };
  },
  /** 界面操作（分配属性点……），不调用模型 */
  action: (saveId: string, body: ActionRequest) =>
    request<{ version: number; notes?: string[] }>("POST", `/saves/${saveId}/actions`, body),
  stop: (saveId: string, turnId: string) =>
    request<{ stopping: boolean }>("POST", `/saves/${saveId}/turns/${turnId}/stop`),
  context: (saveId: string, seq: number) =>
    request<TurnContext>("GET", `/saves/${saveId}/turns/${seq}/context`),
};

/** 每次提交生成一个新的请求 id；同一次提交重发时沿用，后端只执行一次 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
