import type {
  Acquaintance,
  ActionRequest,
  Board,
  BoardModule,
  BoardSlot,
  CharacterCard,
  cyberwareRules,
  ImagePromptRequest,
  ImagePromptResult,
  ImageStyleConfig,
  InstalledWorkshopPack,
  Loadout,
  npcRules,
  PhoneChatRequest,
  PlayerView,
  ProseBlock,
  ProseMode,
  TurnCheckpointSummary,
  TurnInput,
  TurnUsage,
  WorkshopGenerateFocus,
  WorkshopPack,
} from "@cp/core";

import { offscreenPace, spoilersOn } from "../features/settings/prefs";
import type { Gloss } from "../features/story/view";
import { recordClientApiTrace, recordClientDiagnosticError } from "./diagnostics";
import { apiFetch } from "./transport";

/**
 * 浏览器本地接口：通过 transport.ts 交给运行在内存里的游戏服务层，
 * 存档和密钥只存在这个网站自己的浏览器 IndexedDB 里
 */

/** 浏览器本地存储打不开时的提示 */
function unreachable(error: unknown): string {
  const detail = error instanceof Error ? `：${error.message}` : "";
  return `打不开浏览器里的游戏存储${detail}（隐私模式或禁用了站点数据时可能用不了）`;
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
  signal?: AbortSignal,
): Promise<T> {
  const started = performance.now();
  let response: Response;
  try {
    response = await apiFetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const msg = unreachable(error);
    recordClientApiTrace({
      method,
      path,
      status: 0,
      ok: false,
      ms: performance.now() - started,
      error: msg,
    });
    throw new ApiError(msg, 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      const msg = `后端返回了 ${response.status}，内容不是 JSON`;
      recordClientApiTrace({
        method,
        path,
        status: response.status,
        ok: false,
        ms: performance.now() - started,
        error: msg,
      });
      throw new ApiError(msg, response.status);
    }
  }
  if (!response.ok) {
    const details = Array.isArray(data.details) ? `：${data.details.join("；")}` : "";
    const message = typeof data.error === "string" ? data.error : `请求失败（${response.status}）`;
    const fullError = `${message}${details}`;
    recordClientApiTrace({
      method,
      path,
      status: response.status,
      ok: false,
      ms: performance.now() - started,
      error: fullError,
    });
    if (response.status >= 500 || (response.status >= 400 && response.status !== 404)) {
      recordClientDiagnosticError("api", `${method} ${path} -> ${response.status}: ${fullError}`);
    }
    throw new ApiError(fullError, response.status, data);
  }
  recordClientApiTrace({
    method,
    path,
    status: response.status,
    ok: true,
    ms: performance.now() - started,
  });
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
  const started = performance.now();
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
    const msg = unreachable(error);
    recordClientApiTrace({
      method: "POST",
      path,
      status: 0,
      ok: false,
      ms: performance.now() - started,
      error: msg,
    });
    throw new ApiError(msg, 0);
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof data.error === "string" ? data.error : `请求失败（${response.status}）`;
    recordClientApiTrace({
      method: "POST",
      path,
      status: response.status,
      ok: false,
      ms: performance.now() - started,
      error: message,
    });
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
      else if (event.type === "error") {
        recordClientApiTrace({
          method: "POST",
          path,
          status: 502,
          ok: false,
          ms: performance.now() - started,
          error: event.message,
        });
        throw new ApiError(event.message, 502);
      } else {
        recordClientApiTrace({
          method: "POST",
          path,
          status: response.status,
          ok: true,
          ms: performance.now() - started,
        });
        return { truncated: event.truncated };
      }
    }
  }
  const disconnectMsg = "连接中途断开了，可以重试";
  recordClientApiTrace({
    method: "POST",
    path,
    status: 0,
    ok: false,
    ms: performance.now() - started,
    error: disconnectMsg,
  });
  throw new ApiError(disconnectMsg, 0);
}

export interface ImageCapabilities {
  readonly negativePrompt: boolean;
  readonly aspectRatio: boolean;
  readonly size: boolean;
  readonly sampling: boolean;
}

export interface ImagePromptDraftResult extends ImagePromptResult {
  readonly profileName: string | null;
  readonly capabilities: ImageCapabilities | null;
}

export interface ImageModelCapabilities {
  readonly ready: boolean;
  readonly error: string | null;
  readonly profileName: string | null;
  readonly protocol?: string | null;
  readonly model?: string | null;
  readonly capabilities: ImageCapabilities | null;
}

export interface Health {
  readonly ok: boolean;
  readonly config: "ok" | "missing" | "invalid";
  /** 仅检查本地配置，不代表已经连通过服务商 */
  readonly models?: {
    readonly ready: boolean;
    readonly narrator: { readonly ready: boolean; readonly error: string | null };
    readonly aux: { readonly ready: boolean; readonly error: string | null };
    readonly image?: {
      readonly ready: boolean;
      readonly error: string | null;
      readonly capabilities: ImageCapabilities | null;
    };
    readonly embedding?: {
      readonly ready: boolean;
      readonly configured: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
    readonly reranker?: {
      readonly ready: boolean;
      readonly configured: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
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

/** 角色卡：sample 是内容包里的示例，只读 */
export interface CharacterEntry {
  readonly id: string;
  readonly updatedAt: string;
  readonly card: CharacterCard;
  readonly sample: boolean;
}

/** 主板要用的表：模块库和创建时能装的义体 */
export interface BoardData {
  readonly modules: readonly BoardModule[];
  readonly acquaintances?: readonly Acquaintance[];
  readonly cyberware: readonly BoardCyberwareOption[];
  /** 捏人能选成旧识的原作人物；服务端只给公开的几项 */
  readonly npcs: readonly CanonNpcBrief[];
  /** 供自建/修改 NPC 使用的全量义体目录（含传说与不朽） */
  readonly npcCyberware?: readonly NpcCyberwareOption[];
  /** 开局行装可选随身武器（含全部稀有度、不朽与自建/工坊武器） */
  readonly weapons?: readonly StartWeaponOption[];
  /** 开局行装可选非武器随身物品（治疗品、手雷、服装、改装件、消耗品、杂物与自建/工坊物品） */
  readonly items?: readonly StartItemOption[];
  /** 开局行装可选专属载具 */
  readonly vehicles?: readonly StartVehicleOption[];
  /** 可选势力列表（供自建/修改 NPC 表单选择） */
  readonly factions?: readonly BoardFactionOption[];
  /** 可选常驻地点列表（供自建/修改 NPC 表单选择） */
  readonly locations?: readonly BoardLocationOption[];
  /** 出身自带的开局行装表（同建档时 pickLoadouts 用的那张）；旧后端没有 */
  readonly loadouts?: readonly Loadout[];
  /** 物品、载具、程序、义体 id → 中文名 */
  readonly names?: Readonly<Record<string, string>>;
}

export interface StartWeaponOption {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly weaponType?: string;
  readonly rarity: string;
  readonly iconic?: boolean;
  readonly price?: number;
  readonly art?: string;
  readonly customImage?: string;
  readonly ability: string;
  readonly custom?: boolean;
  readonly packId?: string;
}

export interface StartItemOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly rarity: string;
  readonly iconic?: boolean;
  readonly price?: number;
  readonly charges?: number;
  readonly healPercent?: number;
  readonly suppressant?: boolean;
  readonly clothingSlot?: string;
  readonly clothingStyle?: string;
  readonly modSlot?: string;
  readonly modFits?: readonly string[];
  readonly art?: string;
  readonly customImage?: string;
  readonly ability: string;
  readonly custom?: boolean;
  readonly packId?: string;
}

export interface StartVehicleOption {
  readonly id: string;
  readonly name: string;
  readonly maker: string;
  readonly class: string;
  readonly seats: number;
  readonly note?: string;
}

export interface BoardCyberwareOption {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  readonly slotLabel: string;
  readonly category?: cyberwareRules.CyberwareCategoryId;
  readonly categoryLabel?: string;
  /** 稀有度，给格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）；旧后端没有 */
  readonly rarity?: string;
  readonly iconic?: boolean;
  readonly humanityCost: number;
  readonly deckProfile?: string;
  readonly deckTraits?: readonly string[];
  readonly programSlots?: number;
  readonly ram?: number;
  readonly armor?: boolean;
  readonly accelerator?: boolean;
  readonly exclusiveGroup?: cyberwareRules.ExclusiveGroup;
  readonly defaultArmSide?: cyberwareRules.ArmSide;
  readonly capacityBonus?: number;
  readonly safeLineBonus?: number;
  readonly chassisProfile?: cyberwareRules.ChassisProfile;
  readonly variantGroup?: string;
  readonly variantKey?: cyberwareRules.ElementVariantKey;
  readonly smartLink?: boolean;
  readonly carryBonus?: number;
  readonly defenses?: readonly cyberwareRules.CyberwareDefense[];
  readonly art?: string;
  readonly customImage?: string;
  readonly custom?: boolean;
  readonly packId?: string;
  readonly checks?: readonly string[];
  readonly attributes?: Readonly<Record<string, number>>;
  readonly ability: string;
}

export type NpcCyberwareOption = BoardCyberwareOption;

export interface CanonNpcBrief {
  readonly id: string;
  readonly name: string;
  readonly alias?: string;
  readonly role: string;
  readonly look: string;
  readonly faction?: string;
  readonly circle?: string;
  readonly gearCount?: number;
  readonly cyberwareCount?: number;
  readonly packId?: string;
}

export interface BoardFactionOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface BoardLocationOption {
  readonly id: string;
  readonly name: string;
  readonly district: string;
}

export type KeyStatus = "configured" | "missing" | "notNeeded";

export type ProviderType =
  | "gemini"
  | "vertex"
  | "anthropic"
  | "openai"
  | "ollama"
  | "sdwebui"
  | "comfyui"
  | "novelai";

export type ImageProtocol =
  | "auto"
  | "openai-images"
  | "openai-chat"
  | "gemini-native"
  | "gemini-imagen"
  | "sdwebui"
  | "comfyui"
  | "novelai"
  | "wavespeed";

export type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16";

export interface StoredImage {
  readonly id: string;
  readonly dataUrl: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly metadata: {
    readonly profileName: string;
    readonly model: string;
    readonly protocol: Exclude<ImageProtocol, "auto"> | "local-upload";
    readonly requestedPrompt: string;
    readonly sentPrompt: string;
    readonly requestedAspectRatio?: AspectRatio;
    readonly requestedSize?: string;
    readonly sentSize?: string;
    readonly negativePrompt?: string;
    readonly steps?: number;
    readonly cfgScale?: number;
    readonly seed?: number;
    readonly warnings?: readonly string[];
  };
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly revisedPrompt?: string;
  readonly aspectRatio?: string;
  readonly createdAt: string;
}

export interface SaveImageBindings {
  readonly turns: Readonly<Record<string, string>>;
  readonly turnLists?: Readonly<Record<string, readonly string[]>>;
  readonly npcs: Readonly<Record<string, string>>;
  readonly playerPortrait?: string;
}

/** 读取指定回合的有序插图列表（优先读 turnLists，兼容只有 turns[seq] 的旧存档） */
export function turnImagesOf(bindings: SaveImageBindings, seq: number): readonly string[] {
  const key = String(seq);
  const list = bindings.turnLists?.[key];
  if (list && list.length > 0) return list;
  const legacy = bindings.turns[key];
  return legacy ? [legacy] : [];
}

export type SaveImageBindTarget =
  | {
      readonly kind: "turn";
      readonly seq: number;
      readonly imageId: string;
      readonly slot?: number | undefined;
      readonly append?: boolean | undefined;
      readonly replaceAll?: boolean | undefined;
    }
  | { readonly kind: "npc"; readonly npcId: string; readonly imageId: string }
  | { readonly kind: "character"; readonly imageId: string };

export type SaveImageUnbindTarget =
  | {
      readonly kind: "turn";
      readonly seq: number;
      readonly slot?: number | undefined;
      readonly imageId?: string | undefined;
    }
  | { readonly kind: "npc"; readonly npcId: string }
  | { readonly kind: "character" };

/** 后端返回的方案：不含密钥，只说配没配 */
export interface PublicProfile {
  readonly name: string;
  readonly type: ProviderType;
  readonly baseUrl?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly contextWindow: number;
  readonly thinkingLevel?: "low" | "medium" | "high";
  readonly safety?: "off" | "blockNone";
  readonly embeddingModel?: string;
  readonly imageProtocol?: ImageProtocol;
  readonly comfyWorkflow?: string;
  readonly keyStatus: KeyStatus;
  /** 密钥来源：browser config 或尚未填写 */
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
    readonly htmlUi?: boolean;
  }[];
}

export interface PresetPatch {
  readonly entries?: Readonly<Record<string, boolean>>;
  /** 条目 id → 新正文 */
  readonly contents?: Readonly<Record<string, string>>;
  readonly regex?: Readonly<Record<string, boolean>>;
  readonly useSampling?: boolean;
}

export type WorldbookPosition = "before" | "after" | "at_depth";
export type WorldbookSelectiveLogic = 0 | 1 | 2 | 3;

export interface WorldbookEntrySummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly constant: boolean;
  readonly keys: readonly string[];
  readonly secondaryKeys: readonly string[];
  readonly selective: boolean;
  readonly selectiveLogic: WorldbookSelectiveLogic;
  readonly caseSensitive: boolean;
  readonly matchWholeWords: boolean;
  readonly order: number;
  readonly position: WorldbookPosition;
  readonly depth: number;
  readonly role: "system" | "user" | "assistant";
  readonly scanDepth: number | null;
  readonly chars: number;
}

export interface WorldbookEntryDetail extends Omit<WorldbookEntrySummary, "chars"> {
  readonly content: string;
}

export interface WorldbookSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly importedAt: string;
  readonly warnings: readonly string[];
  readonly scanDepth: number;
  readonly recursiveScanning: boolean;
  readonly entries: readonly WorldbookEntrySummary[];
}

export interface WorldbookEntryPatch {
  readonly name?: string;
  readonly content?: string;
  readonly enabled?: boolean;
  readonly constant?: boolean;
  readonly keys?: readonly string[];
  readonly secondaryKeys?: readonly string[];
  readonly selective?: boolean;
  readonly selectiveLogic?: WorldbookSelectiveLogic;
  readonly caseSensitive?: boolean;
  readonly matchWholeWords?: boolean;
  readonly order?: number;
  readonly position?: WorldbookPosition;
  readonly depth?: number;
  readonly role?: "system" | "user" | "assistant";
  readonly scanDepth?: number | null;
}

export interface WorldbookNewEntryInput {
  readonly name: string;
  readonly content?: string;
  readonly enabled?: boolean;
  readonly constant?: boolean;
  readonly keys?: readonly string[];
  readonly secondaryKeys?: readonly string[];
  readonly selective?: boolean;
  readonly selectiveLogic?: WorldbookSelectiveLogic;
  readonly caseSensitive?: boolean;
  readonly matchWholeWords?: boolean;
  readonly order?: number;
  readonly position?: WorldbookPosition;
  readonly depth?: number;
  readonly role?: "system" | "user" | "assistant";
  readonly scanDepth?: number | null;
}

export interface WorldbookPatch {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly scanDepth?: number;
  readonly recursiveScanning?: boolean;
  readonly entryToggles?: Readonly<Record<string, boolean>>;
  readonly entryUpdates?: Readonly<Record<string, WorldbookEntryPatch>>;
  readonly addEntry?: WorldbookNewEntryInput;
  readonly removeEntryId?: string;
}

export type RoleKey = "narrator" | "aux" | "image" | "embedding" | "reranker";
export type RoleModels = Readonly<Partial<Record<RoleKey, string>>>;
export type RoleModelsPatch = Partial<Record<RoleKey, string | null>>;

export interface ProfilesOverview {
  readonly status: "ok" | "missing" | "invalid";
  readonly errors: readonly string[];
  readonly narrator?: string;
  readonly aux?: string;
  readonly image?: string;
  readonly embedding?: string;
  readonly reranker?: string;
  readonly roleModels?: RoleModels;
  readonly profiles: readonly PublicProfile[];
}

export interface ProfilePatch {
  baseUrl?: string;
  model?: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  contextWindow?: number;
  embeddingModel?: string | null;
  imageProtocol?: ImageProtocol;
  comfyWorkflow?: string;
}

/** 新建方案；密钥另外用 setKey 存 */
export interface NewProfile {
  name: string;
  type: PublicProfile["type"];
  model: string;
  baseUrl?: string;
  contextWindow: number;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: PublicProfile["thinkingLevel"];
  safety?: PublicProfile["safety"];
  embeddingModel?: string;
  imageProtocol?: ImageProtocol;
  comfyWorkflow?: string;
  /** 复制连接时在本地直接沿用原连接的密钥（密钥不经前端回传） */
  copyKeyFrom?: string;
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

/** 重新生成时要重发的内容：当时的玩家输入 */
export type Regenerated = { readonly kind: "input"; readonly input: TurnInput };

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

export type TurnBody = { requestId: string; baseVersion: number; input: TurnInput };

export interface RuntimeDiagnosticsReport {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly health: {
    readonly config: string;
    readonly ready: boolean;
    readonly narrator: {
      readonly ready: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
    readonly aux: {
      readonly ready: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
    readonly image: {
      readonly ready: boolean;
      readonly model: string | null;
      readonly protocol?: string | null;
      readonly error: string | null;
    };
    readonly embedding: {
      readonly ready: boolean;
      readonly configured: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
    readonly reranker: {
      readonly ready: boolean;
      readonly configured: boolean;
      readonly model: string | null;
      readonly error: string | null;
    };
  };
  readonly profiles: unknown;
  readonly activePreset: {
    readonly name: string;
    readonly entryCount: number;
    readonly enabledEntries: number;
    readonly sampling: Record<string, unknown> | null;
    readonly enabledEntryList?: readonly {
      readonly id: string;
      readonly name: string;
      readonly role: string;
      readonly depth: number | null;
      readonly chars: number;
    }[];
    readonly enabledRegex?: readonly {
      readonly id: string;
      readonly name: string;
      readonly flags: string;
      readonly promptOnly: boolean;
    }[];
  } | null;
  readonly presets?: readonly {
    readonly id: string;
    readonly name: string;
    readonly importedAt: string;
    readonly entryCount: number;
    readonly enabledEntries: number;
    readonly regexCount: number;
    readonly enabledRegexCount: number;
    readonly warnings: readonly string[];
  }[];
  readonly worldbooks?: readonly {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly importedAt: string;
    readonly entryCount: number;
    readonly enabledEntries: number;
    readonly constantEntries: number;
    readonly warnings: readonly string[];
  }[];
  readonly workshop?: {
    readonly packs?: readonly {
      readonly id: string;
      readonly title: string;
      readonly author: string;
      readonly version: number;
      readonly enabled: boolean;
      readonly installedAt: string;
      readonly counts: Readonly<Record<string, number>>;
    }[];
    readonly error?: string;
  };
  readonly characters?: {
    readonly total?: number;
    readonly custom?: number;
    readonly list?: readonly {
      readonly id: string;
      readonly name: string;
      readonly sample: boolean;
      readonly updatedAt: string;
      readonly origin: string | null;
      readonly cyberwareCount: number;
      readonly moduleCount: number;
      readonly hasPortrait: boolean;
    }[];
    readonly error?: string;
  };
  readonly savesSummary?: readonly SaveSummary[] | { readonly error: string };
  readonly images?: {
    readonly recent?: readonly Omit<StoredImage, "dataUrl">[];
    readonly saveBindings?: SaveImageBindings | null;
    readonly error?: string;
  } | null;
  readonly runtimeLogs: readonly { readonly at: string; readonly message: string }[];
  readonly save: {
    readonly meta: {
      readonly id: string;
      readonly title: string;
      readonly characterId?: string;
      readonly createdAt: string;
      readonly startTime?: number;
      readonly opening?: string | null;
      readonly startLocation: string | null;
      readonly characterName: string | null;
      readonly loadouts?: readonly string[];
      readonly workshopPacks?: readonly {
        readonly id: string;
        readonly title: string;
        readonly version: number;
      }[];
    };
    readonly snapshot: {
      readonly version: number;
      readonly totalTurns: number;
      readonly totalRecords?: number;
      readonly actionCount?: number;
      readonly voidedCount?: number;
      readonly locationId: string | null;
      readonly locationName: string | null;
      readonly gameTime: string;
      readonly worldTimeMinutes?: number;
      readonly eddies: number;
      readonly death: boolean;
      readonly ended: boolean;
      readonly sliceKeys?: readonly string[];
    };
    readonly edgeLedger?: unknown;
    readonly checkpoint: TurnCheckpointSummary | null;
    readonly commerce: {
      readonly activeQuotes: readonly Record<string, unknown>[];
      readonly activeSessions: readonly Record<string, unknown>[];
      readonly registeredParties: readonly Record<string, unknown>[];
    };
    readonly worldState?: {
      readonly time: number;
      readonly slices: Readonly<Record<string, unknown>>;
    };
    readonly characterMeta?: unknown;
    readonly boardStart?: unknown;
    readonly recentActions: readonly {
      readonly seq: number;
      readonly at: string;
      readonly action: unknown;
      readonly notes: readonly string[];
      readonly commands: readonly unknown[];
    }[];
    readonly recentTurns: readonly {
      readonly seq: number;
      readonly at: string;
      readonly ooc: boolean;
      readonly draft?: boolean;
      readonly scene?: number | null;
      readonly title?: string | null;
      readonly input: unknown;
      readonly read: string | null;
      readonly ruling: string | null;
      readonly decided: readonly string[];
      readonly dice?: readonly unknown[];
      readonly check: unknown;
      readonly resolves?: string | null;
      readonly commands: readonly unknown[];
      readonly dropped: readonly { readonly where: string; readonly reason: string }[];
      readonly considered?: readonly string[];
      readonly flags?: readonly string[];
      readonly notes: readonly string[];
      readonly unsettled: string | null;
      readonly recalled?: readonly { readonly title: string; readonly text: string }[];
      readonly expanded?: readonly { readonly title: string; readonly text: string }[];
      readonly retrieval?: unknown;
      readonly lore?: unknown;
      readonly offscreenSkip: string | null;
      readonly offscreen?: { readonly prompt: string; readonly reply: string } | null;
      readonly summary?: { readonly prompt: string; readonly reply: string } | null;
      readonly closeup?: unknown;
      readonly clutch?: boolean;
      readonly choices?: readonly unknown[];
      readonly modules: readonly string[];
      readonly usage: TurnUsage | null;
      readonly budget: unknown;
      readonly text: string;
      readonly thought?: string;
    }[];
    readonly lastTurnStages?: readonly StagePrompt[];
    readonly lastTurnMessages?: readonly { readonly role: string; readonly content: string }[];
    readonly promptRebuildError?: string;
  } | null;
  readonly saveError: string | null;
}

export const api = {
  health: () => request<Health>("GET", "/health"),
  diagnostics: (
    options: {
      readonly saveId?: string | null;
      readonly turns?: number;
      readonly includeThought?: boolean;
      readonly includePrompt?: boolean;
      readonly includeWorldState?: boolean;
      readonly includeImages?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.saveId) params.set("saveId", options.saveId);
    if (options.turns !== undefined) params.set("turns", String(options.turns));
    if (options.includeThought === false) params.set("includeThought", "0");
    if (options.includePrompt === true) params.set("includePrompt", "1");
    if (options.includeWorldState === false) params.set("includeWorldState", "0");
    if (options.includeImages === false) params.set("includeImages", "0");
    const qs = params.toString();
    return request<RuntimeDiagnosticsReport>("GET", qs ? `/diagnostics?${qs}` : "/diagnostics");
  },
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
  /** 酒馆世界书（World Info / Lorebook）：支持多本同时启用、关键词触发、蓝灯常驻、@D 深度与标准 JSON 导出 */
  worldbooks: () => request<{ worldbooks: WorldbookSummary[] }>("GET", "/worldbooks"),
  importWorldbook: (input: { fileName: string; raw: unknown }) =>
    request<{ worldbook: WorldbookSummary }>("POST", "/worldbooks", input),
  createWorldbook: (name: string) =>
    request<{ worldbook: WorldbookSummary }>("POST", "/worldbooks", { createBlank: true, name }),
  exportWorldbook: (id: string) =>
    request<{ fileName: string; data: Record<string, unknown> }>(
      "GET",
      `/worldbooks/${encodeURIComponent(id)}/export`,
    ),
  worldbookEntry: (id: string, entry: string) =>
    request<{ entry: WorldbookEntryDetail }>(
      "GET",
      `/worldbooks/${encodeURIComponent(id)}/entries/${encodeURIComponent(entry)}`,
    ),
  updateWorldbook: (id: string, patch: WorldbookPatch) =>
    request<{ worldbook: WorldbookSummary }>(
      "PATCH",
      `/worldbooks/${encodeURIComponent(id)}`,
      patch,
    ),
  deleteWorldbook: (id: string) =>
    request<{ ok: true }>("DELETE", `/worldbooks/${encodeURIComponent(id)}`),
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
  setRoles: (roles: {
    narrator?: string;
    aux?: string;
    image?: string | null;
    embedding?: string | null;
    reranker?: string | null;
    roleModels?: RoleModelsPatch;
  }) =>
    request<{
      narrator?: string;
      aux?: string;
      image?: string;
      embedding?: string;
      reranker?: string;
      roleModels?: RoleModels;
    }>("PUT", "/profiles/-/roles", roles),
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
  deleteCharacter: (id: string) =>
    request<{ ok: true }>("DELETE", `/characters/${encodeURIComponent(id)}`),
  characterBoard: () => request<BoardData>("GET", "/characters/board"),
  characterBoardNpc: (npcId: string, variant?: "male") =>
    request<{ npc: npcRules.NpcCard }>(
      "GET",
      `/characters/board/npcs/${encodeURIComponent(npcId)}${variant ? `?variant=${variant}` : ""}`,
    ).then((r) => r.npc),
  workshopPackages: () =>
    request<{ packages: InstalledWorkshopPack[] }>("GET", "/workshop").then((r) => r.packages),
  generateWorkshopPack: (
    input: {
      readonly prompt: string;
      readonly focus?: WorkshopGenerateFocus;
      readonly author?: string;
    },
    signal?: AbortSignal,
  ) =>
    request<{
      readonly pack: WorkshopPack;
      readonly issues: readonly string[];
      readonly summary: Readonly<Record<string, number>>;
    }>("POST", "/workshop/generate", input, {}, signal),
  validateWorkshopPack: (pack: unknown, replaceId?: string) =>
    request<{
      valid: boolean;
      issues: readonly string[];
      summary?: Readonly<Record<string, number>>;
    }>(
      "POST",
      replaceId
        ? `/workshop/validate?replaceId=${encodeURIComponent(replaceId)}`
        : "/workshop/validate",
      pack,
    ),
  installWorkshopPack: (pack: WorkshopPack, overwrite = false) =>
    request<{ package: InstalledWorkshopPack }>(
      "POST",
      overwrite ? "/workshop?overwrite=1" : "/workshop",
      pack,
    ),
  updateWorkshopPack: (id: string, pack: WorkshopPack) =>
    request<{ package: InstalledWorkshopPack }>("PUT", `/workshop/${encodeURIComponent(id)}`, pack),
  setWorkshopEnabled: (id: string, enabled: boolean) =>
    request<{ package: InstalledWorkshopPack }>("PATCH", `/workshop/${encodeURIComponent(id)}`, {
      enabled,
    }),
  removeWorkshopPack: (id: string) =>
    request<{ ok: true }>("DELETE", `/workshop/${encodeURIComponent(id)}`),
  /** 自写模块交给辅助模型解读；会花一次模型调用 */
  interpretModule: (input: { slot: BoardSlot; text: string; board: Board }) =>
    request<{ module: BoardModule; warnings: string[] }>("POST", "/characters/interpret", input),
  /** 一句话生成或局部润色 NPC 人物卡；走辅助模型 */
  interpretNpc: (input: {
    readonly text: string;
    readonly existing?:
      | {
          readonly [K in keyof npcRules.NpcCard]?: npcRules.NpcCard[K] | undefined;
        }
      | undefined;
    readonly preserveSpoilers?: boolean | undefined;
  }) =>
    request<{ npc: npcRules.NpcCard }>("POST", "/characters/interpret-npc", input).then(
      (r) => r.npc,
    ),
  /** 角色正文的一个区块交给辅助模型写，流式；会花一次模型调用 */
  streamProse,
  /** 一键成稿：一次写外貌、背景故事、性格、说话方式并补旧识，流式；会花一次模型调用 */
  draftCharacter: streamDraft,
  saves: () => request<{ saves: SaveSummary[] }>("GET", "/saves").then((r) => r.saves),
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
    /** 本地持久化的原作/世界 NPC 改写档案 */
    npcOverrides?: readonly npcRules.NpcCard[];
    /** 本地持久化的自建 NPC 档案 */
    customNpcs?: readonly npcRules.NpcCard[];
  }) => request<SaveSummary>("POST", "/saves", input),
  deleteSave: (saveId: string) =>
    request<{ ok: true }>("DELETE", `/saves/${encodeURIComponent(saveId)}`),
  glossary: () => request<{ glossary: Gloss[] }>("GET", "/glossary").then((r) => r.glossary),
  state: (saveId: string) =>
    request<PlayerView & { readonly checkpoint?: TurnCheckpointSummary }>(
      "GET",
      `/saves/${saveId}/state`,
    ),
  clearCheckpoint: (saveId: string) =>
    request<{ cleared: boolean }>("DELETE", `/saves/${saveId}/checkpoint`),
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
  /** 重新生成最后一轮：后端作废它，返回当时的输入，网页再按原流程提交 */
  regenerate: (saveId: string, baseVersion: number) =>
    request<{ version: number; voided: number; pending: Regenerated }>(
      "POST",
      `/saves/${saveId}/regenerate`,
      { baseVersion },
    ),
  /** 按账目改写最后一轮（未定稿的）：只换正文，账目不动；要等模型写完才返回 */
  rewrite: (saveId: string, baseVersion: number) =>
    request<{ version: number; replaced: number }>("POST", `/saves/${saveId}/rewrite`, {
      baseVersion,
    }),
  undoTurn: (saveId: string, baseVersion: number, fromSeq?: number) =>
    request<{ version: number; voided: number; fromSeq: number; input?: TurnInput }>(
      "POST",
      `/saves/${saveId}/undo`,
      fromSeq === undefined ? { baseVersion } : { baseVersion, fromSeq },
    ),
  stop: (saveId: string, turnId: string) =>
    request<{ stopping: boolean }>("POST", `/saves/${saveId}/turns/${turnId}/stop`),
  context: (saveId: string, seq: number) =>
    request<TurnContext>(
      "GET",
      `/saves/${saveId}/turns/${seq}/context`,
      undefined,
      spoilerHeader(),
    ),
  /** 把这一轮生成成评测用例草稿 JSON 供浏览器下载 */
  evalCase: (saveId: string, seq: number) =>
    request<{ id: string; fileName: string; draft: Record<string, unknown> }>(
      "POST",
      `/saves/${saveId}/turns/${seq}/eval-case`,
      undefined,
      spoilerHeader(),
    ),
  /** 仅解析所选生图模型的配置与能力，不调用模型。 */
  imageCapabilities: (profileName?: string, signal?: AbortSignal) =>
    request<ImageModelCapabilities>(
      "GET",
      `/images/capabilities${profileName ? `?profileName=${encodeURIComponent(profileName)}` : ""}`,
      undefined,
      {},
      signal,
    ),
  /** 提炼文生图英文提示词（可关闭辅助模型直接用本地拼接） */
  draftImagePrompt: (
    input: {
      readonly request: ImagePromptRequest;
      readonly useAux: boolean;
      readonly style?: ImageStyleConfig;
      readonly profileName?: string;
    },
    signal?: AbortSignal,
  ) =>
    apiFetch("/images/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new ApiError(
          typeof data.error === "string" ? data.error : `提示词提炼失败（${res.status}）`,
          res.status,
          data,
        );
      }
      return data as unknown as ImagePromptDraftResult;
    }),
  /** 生成并保存图片；采用图片通过独立的原子绑定接口完成。 */
  generateImage: (
    input: {
      readonly prompt: string;
      readonly negativePrompt?: string;
      readonly aspectRatio?: AspectRatio;
      readonly steps?: number;
      readonly cfgScale?: number;
      readonly seed?: number;
      readonly size?: string;
      readonly profileName?: string;
    },
    signal?: AbortSignal,
  ) =>
    apiFetch("/images/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new ApiError(
          typeof data.error === "string" ? data.error : `文生图失败（${res.status}）`,
          res.status,
          data,
        );
      }
      return data as { readonly image: StoredImage };
    }),
  /** 上传本地图片（PNG / JPEG / 静态 WebP）并保存到浏览器本地 ImageStore */
  uploadImage: (
    input: { readonly dataUrl: string; readonly label?: string },
    signal?: AbortSignal,
  ) =>
    apiFetch("/images/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new ApiError(
          typeof data.error === "string" ? data.error : `上传图片失败（${res.status}）`,
          res.status,
          data,
        );
      }
      return data as { readonly image: StoredImage };
    }),
  /** 上传/读取立绘图片并调用视觉模型反推出中文物理外貌描述 */
  describeAppearance: (
    input: {
      readonly dataUrl?: string;
      readonly imageId?: string;
      readonly pronoun?: string;
      readonly hint?: string;
      readonly purpose?: "aux" | "narrator";
    },
    signal?: AbortSignal,
  ) =>
    apiFetch("/images/describe-appearance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }).then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new ApiError(
          typeof data.error === "string" ? data.error : `反推外貌失败（${res.status}）`,
          res.status,
          data,
        );
      }
      return data as {
        readonly look: string;
        readonly profileName: string;
        readonly model: string;
        readonly usedPurpose: "aux" | "narrator";
      };
    }),
  getImage: (id: string) =>
    request<{ readonly image: StoredImage }>("GET", `/images/${encodeURIComponent(id)}`).then(
      (r) => r.image,
    ),
  deleteImage: (id: string) =>
    request<{ readonly ok: boolean }>("DELETE", `/images/${encodeURIComponent(id)}`),
  saveImages: (saveId: string) =>
    request<{ readonly bindings: SaveImageBindings }>(
      "GET",
      `/saves/${encodeURIComponent(saveId)}/images`,
    ).then((r) => r.bindings),
  bindSaveImage: (
    saveId: string,
    target: SaveImageBindTarget & { readonly expectedImageId?: string | null },
    signal?: AbortSignal,
  ) =>
    request<{ readonly bindings: SaveImageBindings }>(
      "PUT",
      `/saves/${encodeURIComponent(saveId)}/images`,
      target,
      {},
      signal,
    ).then((r) => r.bindings),
  unbindSaveImage: (saveId: string, target: SaveImageUnbindTarget) =>
    request<{ readonly bindings: SaveImageBindings }>(
      "DELETE",
      `/saves/${encodeURIComponent(saveId)}/images`,
      target,
    ).then((r) => r.bindings),
};

/** 每次提交生成一个新的请求 id；同一次提交重发时沿用，后端只执行一次 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
