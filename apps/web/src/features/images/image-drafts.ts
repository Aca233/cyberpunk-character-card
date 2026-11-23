import {
  IMAGE_INSTRUCTION_MAX_LENGTH,
  IMAGE_NEGATIVE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH,
  type ImagePromptRequest,
} from "@cp/core";
import type { AspectRatio, ImageCapabilities } from "../../api/client";

export interface SavedImageDraft {
  readonly sourceKey: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly instruction: string;
  readonly useAux: boolean;
  readonly aspectRatio: AspectRatio;
  readonly profileName: string | null;
  readonly capabilities: ImageCapabilities | null;
}

interface CacheEntry {
  readonly key: string;
  readonly updatedAt: number;
  readonly draft: SavedImageDraft;
}

const STORAGE_KEY = "cp.imagePromptDrafts";
const MAX_DRAFTS = 50;
const MAX_KEY_LENGTH = 512;
const MAX_STORED_LENGTH = MAX_DRAFTS * 48000 * 6;
const memory = new Map<string, CacheEntry>();
const RATIOS: readonly string[] = ["1:1", "3:4", "4:3", "16:9", "9:16"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function capabilities(value: unknown): ImageCapabilities | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    typeof value.negativePrompt !== "boolean" ||
    typeof value.aspectRatio !== "boolean" ||
    typeof value.size !== "boolean" ||
    typeof value.sampling !== "boolean"
  ) {
    return undefined;
  }
  return {
    negativePrompt: value.negativePrompt,
    aspectRatio: value.aspectRatio,
    size: value.size,
    sampling: value.sampling,
  };
}

function parseDraft(value: unknown): SavedImageDraft | null {
  if (
    !record(value) ||
    !text(value.sourceKey, 160) ||
    !text(value.prompt, IMAGE_PROMPT_MAX_LENGTH) ||
    !text(value.negativePrompt, IMAGE_NEGATIVE_PROMPT_MAX_LENGTH) ||
    !text(value.instruction, IMAGE_INSTRUCTION_MAX_LENGTH) ||
    typeof value.useAux !== "boolean" ||
    typeof value.aspectRatio !== "string" ||
    !RATIOS.includes(value.aspectRatio) ||
    !(value.profileName === null || text(value.profileName, 160))
  ) {
    return null;
  }
  const parsedCapabilities = capabilities(value.capabilities);
  if (parsedCapabilities === undefined) return null;
  return {
    sourceKey: value.sourceKey,
    prompt: value.prompt,
    negativePrompt: value.negativePrompt,
    instruction: value.instruction,
    useAux: value.useAux,
    aspectRatio: value.aspectRatio as AspectRatio,
    profileName: value.profileName,
    capabilities: parsedCapabilities,
  };
}

function trimCache(): readonly CacheEntry[] {
  const recent = [...memory.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DRAFTS);
  memory.clear();
  for (const entry of recent) memory.set(entry.key, entry);
  return recent;
}

function loadCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length > MAX_STORED_LENGTH) return;
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > MAX_DRAFTS) return;
    for (const entry of entries) {
      if (
        !record(entry) ||
        !text(entry.key, MAX_KEY_LENGTH) ||
        entry.key.length === 0 ||
        typeof entry.updatedAt !== "number" ||
        !Number.isSafeInteger(entry.updatedAt) ||
        entry.updatedAt < 0 ||
        entry.updatedAt > Date.now() + 60000
      ) {
        continue;
      }
      const draft = parseDraft(entry.draft);
      if (!draft) continue;
      const current = memory.get(entry.key);
      if (!current || entry.updatedAt > current.updatedAt) {
        memory.set(entry.key, { key: entry.key, updatedAt: entry.updatedAt, draft });
      }
    }
    trimCache();
  } catch {
    // 存储被禁用、额度不足或 JSON 损坏时，当前会话的内存草稿仍然可用。
  }
}

export function readImageDraft(key: string): SavedImageDraft | null {
  loadCache();
  const draft = memory.get(key)?.draft;
  return draft ? parseDraft(draft) : null;
}

export function writeImageDraft(key: string, draft: SavedImageDraft): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return;
  const parsed = parseDraft(draft);
  if (!parsed) return;
  loadCache();
  const updatedAt = Math.max(Date.now(), (memory.get(key)?.updatedAt ?? 0) + 1);
  memory.set(key, { key, updatedAt, draft: parsed });
  const entries = trimCache();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 先更新内存再尝试落盘，失败不清除刚输入的内容。
  }
}

/** 仅用于资料变更提醒；不把正文存入缓存，也不作为授权或安全校验。 */
export function imagePromptSourceKey(request: ImagePromptRequest): string {
  const source = JSON.stringify(request, (_key, value: unknown) =>
    record(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : value,
  );
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `image-source-${source.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
