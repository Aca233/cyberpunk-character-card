import type { Draft } from "immer";
import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { applyBulletin, applyCityEvent, applyRumor, applyRumorHeard } from "./apply";
import { cityFeed } from "./feed";
import { cityRules } from "./prompt";
import {
  CityBulletinCommandSchema,
  CityEventCommandSchema,
  CityFailedSchema,
  type CityInternal,
  CityRanSchema,
  CityRumorCommandSchema,
  type CityState,
  CityStateSchema,
  emptyOffscreenCursor,
  type OffscreenCursor,
  type OffscreenTrack,
  type RumorHeard,
  RumorHeardSchema,
} from "./schema";
import { citySections } from "./sections";
import { bulletinsView } from "./view";

function syncSummaryCursor(draft: Draft<CityState>): void {
  const m = draft.macro;
  const s = draft.social;
  draft.processedThrough = Math.min(m.processedThrough, s.processedThrough);
  draft.backlog = m.backlog || s.backlog;
  draft.lastScene =
    m.lastScene === null || s.lastScene === null
      ? (m.lastScene ?? s.lastScene)
      : Math.min(m.lastScene, s.lastScene);
  draft.lastAt =
    m.lastAt === null || s.lastAt === null ? (m.lastAt ?? s.lastAt) : Math.min(m.lastAt, s.lastAt);
  draft.lastAttemptAt =
    m.lastAttemptAt === null || s.lastAttemptAt === null
      ? (m.lastAttemptAt ?? s.lastAttemptAt)
      : Math.max(m.lastAttemptAt, s.lastAttemptAt);
  const retries = [m.retryAt, s.retryAt].filter((x): x is number => x !== null);
  draft.retryAt = retries.length > 0 ? Math.min(...retries) : null;
  const retrySeqs = [m.retrySeq, s.retrySeq].filter((x): x is number => x !== null);
  draft.retrySeq = retrySeqs.length > 0 ? Math.min(...retrySeqs) : null;
  draft.failures = Math.max(m.failures, s.failures);
}

function updateCursorFailed(
  cursor: Draft<OffscreenCursor>,
  now: number,
  retrySeq: number | null | undefined,
): void {
  cursor.lastAttemptAt = now;
  cursor.failures += 1;
  cursor.retryAt = now + Math.min(120, 15 * 2 ** Math.min(3, cursor.failures - 1));
  cursor.retrySeq = retrySeq ?? null;
}

function updateCursorRan(
  cursor: Draft<OffscreenCursor>,
  through: number,
  backlog: boolean,
  scene: number,
  now: number,
): string | undefined {
  if (through < cursor.processedThrough) return "场外推演成功游标不能倒退";
  if (backlog && through === cursor.processedThrough) return "分批推演必须实际处理至少一轮";
  cursor.lastAttemptAt = now;
  if (!backlog) {
    cursor.lastScene = scene;
    cursor.lastAt = now;
  }
  cursor.processedThrough = through;
  cursor.backlog = backlog;
  cursor.failures = 0;
  cursor.retryAt = null;
  cursor.retrySeq = null;
  return undefined;
}

/** 城里的动静：统一媒体播报、街头传闻、底层城市事件索引与双通道场外推演游标 */
export const city = defineSystem<CityState, RumorHeard, CityInternal>({
  id: "city",
  dependsOn: ["world"],
  state: CityStateSchema,
  initial: () => ({
    events: [],
    rumors: [],
    nextRumor: 1,
    bulletins: [],
    nextBulletin: 1,
    macro: emptyOffscreenCursor(),
    social: emptyOffscreenCursor(),
    lastScene: null,
    lastAt: null,
    processedThrough: -1,
    backlog: false,
    lastAttemptAt: null,
    retryAt: null,
    retrySeq: null,
    failures: 0,
  }),
  commands: { rumorHeard: RumorHeardSchema },
  internal: {
    "city.event": CityEventCommandSchema,
    "city.rumor": CityRumorCommandSchema,
    "city.bulletin": CityBulletinCommandSchema,
    "city.ran": CityRanSchema,
    "city.failed": CityFailedSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "rumorHeard") return applyRumorHeard(draft, command);
    if (command.type === "city.event") return applyCityEvent(draft, command, ctx.now);
    if (command.type === "city.rumor") return applyRumor(draft, command, ctx.now);
    if (command.type === "city.bulletin") return applyBulletin(draft, command, ctx.now);
    const tracks: readonly OffscreenTrack[] =
      command.track !== undefined ? [command.track] : ["macro", "social"];
    if (command.type === "city.failed") {
      for (const track of tracks) updateCursorFailed(draft[track], ctx.now, command.retrySeq);
      syncSummaryCursor(draft);
      return { ok: true };
    }
    const scene = ctx.read<WorldClockState>("world").scene;
    for (const track of tracks) {
      const error = updateCursorRan(draft[track], command.through, command.backlog, scene, ctx.now);
      if (error) return { ok: false, reason: error };
    }
    syncSummaryCursor(draft);
    return { ok: true };
  },
  rules: [cityRules],
  sections: citySections,
  view: { key: "bulletins", project: bulletinsView },
  feed: cityFeed,
});

export * from "./apply";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
