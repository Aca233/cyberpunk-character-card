import type {
  ActionRequest,
  Board,
  BoardModule,
  BoardSlot,
  CharacterCard,
  Combo,
  LifepathEntry,
  PlayerView,
  ProseBlock,
  ProseMode,
  TurnInput,
  TurnUsage,
} from "@cp/core";

import { encounterPace, offscreenPace, spoilersOn } from "../features/settings/prefs";
import type { Gloss } from "../features/story/view";

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

/** 剧透调试视图的接口要带这个头；后端开发模式下不看 */
const spoilerHeader = () => ({ "x-cp-spoilers": spoilersOn() ? "1" : "0" });

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
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

export interface ProseInput {
  readonly card: CharacterCard;
  readonly block: ProseBlock;
  readonly mode: ProseMode;
  readonly instruction?: string;
}

/**
 * 角色正文：后端按行吐 JSON 事件，边收边交给 onText；停止时 fetch 抛 AbortError，由调用方处理。
 * 返回 truncated：模型写超了字数，后面的被截掉
 */
async function streamProse(
  input: ProseInput,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ truncated: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/characters/prose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("连不上后端：确认已经在项目根目录运行 pnpm --filter @cp/server dev", 0);
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof data.error === "string" ? data.error : `请求失败（${response.status}）`;
    throw new ApiError(message, response.status, data);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const event = JSON.parse(line) as
        | { type: "text"; text: string }
        | { type: "error"; message: string }
        | { type: "done"; truncated: boolean };
      if (event.type === "text") onText(event.text);
      else if (event.type === "error") throw new ApiError(event.message, 502);
      else return { truncated: event.truncated };
    }
  }
  throw new ApiError("连接中途断开了，可以重试", 0);
}

export interface Health {
  readonly ok: boolean;
  readonly config: "ok" | "missing" | "invalid";
  readonly dev: boolean;
  /** 仅检查本机配置，不代表已经连通过服务商。兼容旧后端。 */
  readonly models?: {
    readonly ready: boolean;
    readonly narrator: { readonly ready: boolean; readonly error: string | null };
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

/** 主板要用的表：模块库、联动、生命路径和创建时能装的义体 */
export interface BoardData {
  readonly modules: readonly BoardModule[];
  readonly combos: readonly Combo[];
  readonly lifepath: readonly LifepathEntry[];
  readonly cyberware: readonly {
    readonly id: string;
    readonly name: string;
    readonly slot: string;
    readonly slotLabel: string;
    readonly points: number;
    readonly humanityCost: number;
    readonly ability: string;
  }[];
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
  readonly narrator?: string;
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

/** 重新生成时要重发的内容：当时的输入，或当时确认的检定 */
export type Regenerated =
  | { readonly kind: "input"; readonly input: TurnInput }
  | { readonly kind: "confirm"; readonly checkId: string; readonly label: string };

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
  /** 抽取考虑过但没抽的，和原因 */
  readonly considered: readonly string[];
  /** 判断定检定或门槛的理由；没有为 null，旧后端没有 */
  readonly ruling?: string | null;
  /** ⑤ 审守则的提醒；旧后端没有 */
  readonly flags?: readonly string[];
  /** ⑥ 场外推演没跑的原因；跑了为 null，旧后端没有 */
  readonly offscreenSkip?: string | null;
  /** 这一轮之后城里的动静；旧后端没有 */
  readonly city?: readonly CityEventView[];
  /** 账目对账：最近 10 轮各改了哪些硬数值；旧版后端没有 */
  readonly ledger?: readonly LedgerEntryView[];
  /** 未定稿的原因；定稿的轮次为 null */
  readonly unsettled: string | null;
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
  /** 按阶段重建的提示词：① 判断、③ 写正文、④ 抽取（没有这一步的轮次不列） */
  readonly prompts?: readonly StagePrompt[];
  readonly rebuildError: string | null;
}

export interface StagePrompt {
  readonly stage: "judge" | "narrate" | "extract" | "offscreen";
  readonly label: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly modules: readonly string[];
  readonly chars: number;
}

/** 上下文查看器里的一条城里的动静 */
/** 账目对账的一条：一个回合或一次界面操作 */
export interface LedgerEntryView {
  readonly seq: number;
  readonly kind: "turn" | "action";
  readonly changes: readonly {
    readonly label: string;
    readonly before: number | null;
    readonly after: number | null;
  }[];
  readonly commands: readonly unknown[];
}

export interface CityEventView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly district: string | null;
  readonly status: string;
  readonly weight: "minor" | "normal" | "major";
  readonly over: boolean;
  readonly updatedAt: number;
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
  setRoles: (roles: { narrator?: string; aux?: string }) =>
    request<{ narrator: string; aux: string }>("PUT", "/profiles/-/roles", roles),
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
  characterBoard: () => request<BoardData>("GET", "/characters/board"),
  /** 自写模块交给辅助模型解读；会花一次模型调用 */
  interpretModule: (input: { slot: BoardSlot; text: string; board: Board }) =>
    request<{ module: BoardModule; warnings: string[] }>("POST", "/characters/interpret", input),
  /** 角色正文的一个区块交给辅助模型写，流式；会花一次模型调用 */
  streamProse,
  /** 导入 Character Card；useModel 时花一次模型调用插主板、分属性。结果不保存，由玩家确认 */
  importCharacter: (input: { raw: unknown; useModel: boolean }) =>
    request<{ card: CharacterCard; warnings: string[]; own: boolean }>(
      "POST",
      "/characters/import",
      input,
    ),
  saves: () => request<{ saves: SaveSummary[] }>("GET", "/saves").then((r) => r.saves),
  /** 完整导出：整份存档（含剧透），网页原样下载成文件 */
  exportSave: (saveId: string) =>
    request<Record<string, unknown>>("GET", `/saves/${saveId}/export`),
  /** 导入完整导出的文件，建成一个新存档；notes 是快照对不上之类的提示 */
  importSave: (data: unknown) =>
    request<SaveSummary & { notes: readonly string[] }>("POST", "/saves/import", data),
  createSave: (input: { title: string; characterId: string; difficulty: Difficulty }) =>
    request<SaveSummary>("POST", "/saves", input),
  glossary: () => request<{ glossary: Gloss[] }>("GET", "/glossary").then((r) => r.glossary),
  state: (saveId: string) => request<PlayerView>("GET", `/saves/${saveId}/state`),
  async submit(saveId: string, body: TurnBody): Promise<SubmitResult> {
    const r = await request<Record<string, unknown>>("POST", `/saves/${saveId}/turns`, {
      ...body,
      offscreen: offscreenPace(),
      encounters: encounterPace(),
    });
    if (typeof r.turnId === "string") return { kind: "started", turnId: r.turnId };
    return { kind: "duplicate", seq: Number(r.seq), version: Number(r.version) };
  },
  /** 界面操作（分配属性点……），不调用模型 */
  action: (saveId: string, body: ActionRequest) =>
    request<{ version: number; notes?: string[] }>("POST", `/saves/${saveId}/actions`, body),
  /** 夜之城难度死亡后从这个场景开头重来；每个场景一次 */
  restart: (saveId: string, baseVersion: number) =>
    request<{ version: number; voided: number }>("POST", `/saves/${saveId}/restart`, {
      baseVersion,
    }),
  /** 重新生成最后一轮：后端作废它，返回当时的输入或检定，网页再按原流程提交；骰子不重掷 */
  regenerate: (saveId: string, baseVersion: number) =>
    request<{ version: number; voided: number; pending: Regenerated }>(
      "POST",
      `/saves/${saveId}/regenerate`,
      { baseVersion },
    ),
  /** 按账目改写最后一轮（未定稿的）：只换正文，账目和骰子不动；要等模型写完才返回 */
  rewrite: (saveId: string, baseVersion: number) =>
    request<{ version: number; replaced: number }>("POST", `/saves/${saveId}/rewrite`, {
      baseVersion,
    }),
  stop: (saveId: string, turnId: string) =>
    request<{ stopping: boolean }>("POST", `/saves/${saveId}/turns/${turnId}/stop`),
  context: (saveId: string, seq: number) =>
    request<TurnContext>(
      "GET",
      `/saves/${saveId}/turns/${seq}/context`,
      undefined,
      spoilerHeader(),
    ),
  /** 把这一轮存成评测用例草稿，返回草稿在仓库里的路径 */
  evalCase: (saveId: string, seq: number) =>
    request<{ id: string; file: string }>(
      "POST",
      `/saves/${saveId}/turns/${seq}/eval-case`,
      undefined,
      spoilerHeader(),
    ),
};

/** 每次提交生成一个新的请求 id；同一次提交重发时沿用，后端只执行一次 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
