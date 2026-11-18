import type {
  ActionRequest,
  Board,
  BoardModule,
  BoardSlot,
  CharacterCard,
  Legend,
  LifepathEntry,
  Loadout,
  PhoneChatRequest,
  PlayerView,
  ProseBlock,
  ProseMode,
  TurnInput,
  TurnUsage,
} from "@cp/core";

import { offscreenPace, spoilersOn } from "../features/settings/prefs";
import type { Gloss } from "../features/story/view";
import { apiFetch, LOCAL_MODE } from "./transport";

/**
 * 后端接口。连服务器时走同源的 /api（开发时由 Vite 转给 127.0.0.1 上的后端），网页里没有任何密钥；
 * 本地模式（静态网站）下同一套接口在浏览器里直接跑，密钥只存在这个网站自己的浏览器存储里
 */

/** 请求根本没送到的提示：本地模式是浏览器存储打不开，连服务器时是后端没启动 */
function unreachable(error: unknown): string {
  if (LOCAL_MODE) {
    const detail = error instanceof Error ? `：${error.message}` : "";
    return `打不开浏览器里的游戏存储${detail}（隐私模式或禁用了站点数据时可能用不了）`;
  }
  return "连不上后端：确认已经在项目根目录运行 pnpm --filter @cp/server dev";
}

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
    response = await apiFetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new ApiError(unreachable(error), 0);
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
function streamProse(
  input: ProseInput,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ truncated: boolean }> {
  return streamEvents("/characters/prose", input, onText, signal);
}

export interface DraftInput {
  readonly card: CharacterCard;
  readonly instruction?: string;
}

/**
 * 一键成稿（第三期，用户定的 2026-10-30）：和逐块写一样按行吐事件，原文带【外貌】这类标记，
 * 收齐后由调用方用 core 的 splitDraft 拆开
 */
function streamDraft(
  input: DraftInput,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ truncated: boolean }> {
  return streamEvents("/characters/draft", input, onText, signal);
}

/** 逐块写和一键成稿共用：POST 之后按行读 JSON 事件（text / error / done） */
async function streamEvents(
  path: string,
  input: unknown,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<{ truncated: boolean }> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(unreachable(error), 0);
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

export interface SaveSummary {
  readonly id: string;
  readonly title: string;
  readonly characterId: string;
  readonly createdAt: string;
  readonly startTime: number;
  readonly running: boolean;
}

/** 名册里的一位：带上存档 id 和标题，好点回去回看 */
export type SavedLegend = Legend & { readonly saveId: string; readonly title: string };

/** 角色卡：sample 是内容包里的示例，只读 */
export interface CharacterEntry {
  readonly id: string;
  readonly updatedAt: string;
  readonly card: CharacterCard;
  readonly sample: boolean;
}

/** 主板要用的表：模块库、生命路径和创建时能装的义体 */
export interface BoardData {
  readonly modules: readonly BoardModule[];
  readonly lifepath: readonly LifepathEntry[];
  readonly cyberware: readonly {
    readonly id: string;
    readonly name: string;
    readonly slot: string;
    readonly slotLabel: string;
    /** 稀有度，给格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）；旧后端没有 */
    readonly rarity?: string;
    readonly humanityCost: number;
    readonly programSlots?: number;
    readonly ram?: number;
    readonly armor?: boolean;
    readonly accelerator?: boolean;
    readonly checks?: readonly string[];
    readonly attributes?: Readonly<Record<string, number>>;
    readonly ability: string;
  }[];
  /** 捏人能选成旧识的原作人物；服务端只给公开的几项 */
  readonly npcs: readonly CanonNpcBrief[];
  /** 开局行装可选随身武器（普通/罕见/稀有） */
  readonly weapons?: readonly StartWeaponOption[];
  /** 开局行装可选专属载具 */
  readonly vehicles?: readonly StartVehicleOption[];
  /** 出身自带的开局行装表（同建档时 pickLoadouts 用的那张）；旧后端没有 */
  readonly loadouts?: readonly Loadout[];
  /** 物品、载具、程序、义体 id → 中文名 */
  readonly names?: Readonly<Record<string, string>>;
}

export interface StartWeaponOption {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly rarity: string;
  readonly ability: string;
}

export interface StartVehicleOption {
  readonly id: string;
  readonly name: string;
  readonly maker: string;
  readonly class: string;
  readonly seats: number;
  readonly note?: string;
}

export interface CanonNpcBrief {
  readonly id: string;
  readonly name: string;
  readonly alias?: string;
  readonly role: string;
  readonly look: string;
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

/** 酒馆预设摘要：与 /api/presets 对齐，不包含提示词全文或脚本源码。 */
export interface PresetSummary {
  readonly id: string;
  readonly name: string;
  readonly importedAt: string;
  readonly active: boolean;
  readonly warnings: readonly string[];
  readonly sampling: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
    readonly maxOutputTokens?: number;
  };
  readonly entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: "system" | "user" | "assistant";
    readonly enabled: boolean;
    readonly depth: number | null;
    readonly chars: number;
  }[];
  readonly regex: readonly {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
  }[];
}

export interface PresetPatch {
  readonly entries?: Readonly<Record<string, boolean>>;
  /** 条目 id → 新正文 */
  readonly contents?: Readonly<Record<string, string>>;
  readonly regex?: Readonly<Record<string, boolean>>;
  readonly useSampling?: boolean;
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

export interface FetchModelsInput {
  readonly profileName?: string;
  readonly type?: PublicProfile["type"];
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

export type ModelsResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly error: string };

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
  /** 判断调的旧记忆标题；旧后端没有 */
  readonly recalled?: readonly string[];
  /** 扩展层：检索原因、前几名分数、补进来的标题和退回原因；没检索为 null，旧后端没有 */
  readonly retrieval?: {
    readonly triggers: readonly string[];
    readonly top: readonly {
      readonly id: string;
      readonly title: string;
      readonly score: number;
      readonly parts: string;
    }[];
    readonly fallback: readonly string[];
    readonly picked: readonly string[];
  } | null;
  /** 设定库：检索词、挑中的原作资料和分数、没给的原因；没接文本库或旧记录为 null，旧后端没有 */
  readonly lore?: {
    readonly terms: readonly string[];
    readonly picked: readonly {
      readonly source: string;
      readonly title: string;
      readonly kind: string;
      readonly score: number;
      readonly hits: readonly string[];
    }[];
    readonly candidates: number;
    readonly note: string | null;
  } | null;
  /** 上下文预算：窗口、带了几轮原文、各部分用量对上限、砍掉了什么；旧记录为 null，旧后端没有 */
  readonly budget?: {
    readonly window: number;
    readonly history: number;
    readonly recapTokens: number;
    readonly parts: readonly {
      readonly part: string;
      readonly label: string;
      readonly tokens: number;
      readonly limit: number | null;
    }[];
    readonly total: number;
    readonly limit: number;
    readonly cuts: readonly string[];
  } | null;
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
  readonly stage: "judge" | "narrate" | "extract" | "offscreen" | "summary";
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
  | { confirm: string; matrix?: number }
);

export const api = {
  health: () => request<Health>("GET", "/health"),
  /** 酒馆预设管理：只访问本机后端，不发送模型请求；导入后需单独启用。 */
  tavernPresets: () =>
    request<{ active: string | null; presets: PresetSummary[] }>("GET", "/presets"),
  importPreset: (input: { fileName: string; raw: unknown }) =>
    request<{ preset: PresetSummary }>("POST", "/presets", input),
  setActivePreset: (id: string | null) =>
    request<{ active: string | null }>("PUT", "/presets/-/active", { id }),
  updatePreset: (id: string, patch: PresetPatch) =>
    request<{ preset: PresetSummary }>("PATCH", `/presets/${encodeURIComponent(id)}`, patch),
  /** 展开条目时取正文：列表只带字数，不带全文 */
  presetEntry: (id: string, entry: string) =>
    request<{ id: string; content: string }>(
      "GET",
      `/presets/${encodeURIComponent(id)}/entries/${encodeURIComponent(entry)}`,
    ),
  deletePreset: (id: string) =>
    request<{ ok: true }>("DELETE", `/presets/${encodeURIComponent(id)}`),
  profiles: () => request<ProfilesOverview>("GET", "/profiles"),
  updateProfile: (name: string, patch: ProfilePatch) =>
    request<{ profile: PublicProfile }>("PUT", `/profiles/${encodeURIComponent(name)}`, patch),
  /** 会用这个方案发一条很短的请求，产生极少量费用 */
  testProfile: (name: string) =>
    request<ConnectionTest>("POST", `/profiles/${encodeURIComponent(name)}/test`),
  /** 按当前表单参数或已保存密钥向提供方拉取模型列表（不落盘、不扣对话费） */
  fetchModels: (input: FetchModelsInput) =>
    request<ModelsResult>("POST", "/profiles/-/models", input),
  /** 照 config.example.json 建一份 config.json（已有就不动） */
  initConfig: () => request<{ ok: true }>("POST", "/profiles/-/init"),
  setRoles: (roles: { narrator?: string; aux?: string }) =>
    request<{ narrator?: string; aux?: string }>("PUT", "/profiles/-/roles", roles),
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
  /** 一键成稿：一次写外貌、背景故事、性格、说话方式并补旧识，流式；会花一次模型调用 */
  draftCharacter: streamDraft,
  /** 导入 Character Card；useModel 时花一次模型调用插主板、分属性。结果不保存，由玩家确认 */
  importCharacter: (input: { raw: unknown; useModel: boolean }) =>
    request<{ card: CharacterCard; warnings: string[]; own: boolean }>(
      "POST",
      "/characters/import",
      input,
    ),
  saves: () => request<{ saves: SaveSummary[] }>("GET", "/saves").then((r) => r.saves),
  /** 传说名册：死了不能重来、或者收了尾的角色，最近的在前 */
  legends: () =>
    request<{ legends: SavedLegend[] }>("GET", "/saves/legends").then((r) => r.legends),
  /** 完整导出：整份存档（含剧透），网页原样下载成文件 */
  exportSave: (saveId: string) =>
    request<Record<string, unknown>>("GET", `/saves/${saveId}/export`),
  /** 导入完整导出的文件，建成一个新存档；notes 是快照对不上之类的提示 */
  importSave: (data: unknown) =>
    request<SaveSummary & { notes: readonly string[] }>("POST", "/saves/import", data),
  createSave: (input: {
    title: string;
    characterId: string;
    /** 地图上选中的开局地点 id（用户定的，2026-10-30：“在地图上选择”）；不传沿用默认开局 */
    startLocation?: string;
  }) => request<SaveSummary>("POST", "/saves", input),
  glossary: () => request<{ glossary: Gloss[] }>("GET", "/glossary").then((r) => r.glossary),
  state: (saveId: string) => request<PlayerView>("GET", `/saves/${saveId}/state`),
  async submit(saveId: string, body: TurnBody): Promise<SubmitResult> {
    const r = await request<Record<string, unknown>>("POST", `/saves/${saveId}/turns`, {
      ...body,
      offscreen: offscreenPace(),
    });
    if (typeof r.turnId === "string") return { kind: "started", turnId: r.turnId };
    return { kind: "duplicate", seq: Number(r.seq), version: Number(r.version) };
  },
  /** 界面操作（习惯、医疗、义体……），不调用模型 */
  action: (saveId: string, body: ActionRequest) =>
    request<{ version: number; notes?: string[] }>("POST", `/saves/${saveId}/actions`, body),
  /** 手机私信直聊：只调用辅助模型，推进 1–3 分钟时钟并更新双人会话与关联委托 */
  phoneChat: (saveId: string, body: PhoneChatRequest) =>
    request<{ version: number; notes?: string[]; reply?: string; minutes?: number }>(
      "POST",
      `/saves/${saveId}/phone/chat`,
      body,
    ),
  /** 死亡后从当前场景开头重来；每个场景一次 */
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
