import type { ApplyOutcome } from "../../kernel/system";
import {
  BEHAVIOR_CHIP_MODE_LABELS,
  type BehaviorChipMode,
  type BehaviorChipState,
  type BehaviorChipTerms,
  type CyberwareDef,
} from "./schema";

export function isActiveBehaviorMode(mode: BehaviorChipMode | undefined): boolean {
  return mode !== undefined && mode !== "off";
}

/** 行为芯片四态模型：off（清醒）/ doll（玩偶托管）/ protocol（改装协议）/ glitch（故障被骇） */
export function applyBehaviorChip(
  states: Record<string, BehaviorChipState>,
  installed: readonly string[],
  command: BehaviorChipTerms,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  broken: readonly string[] = [],
): ApplyOutcome {
  const def = catalog.get(command.device);
  if (!def?.behaviorChip || !installed.includes(command.device)) {
    return { ok: false, reason: "本人没有实际安装这件行为芯片，获得或读取芯片载体不能直接启动它" };
  }
  const profile = def.behaviorChip;
  const previous = states[command.device];
  const state: BehaviorChipState = previous ?? {
    mode: "off",
    protocol: null,
    carrier: null,
    since: now,
    memoryGap: false,
    logs: [],
  };

  if (command.action === "mode") {
    if (!command.mode) return { ok: false, reason: "切换行为芯片状态需要指定 mode" };
    if (command.mode === "protocol" && !command.protocol) {
      return { ok: false, reason: "切入改装协议（protocol）时须写明当前刷入的协议名称" };
    }
    if (
      command.mode === state.mode &&
      (command.mode !== "protocol" ||
        (command.protocol === state.protocol &&
          (command.carrier ?? null) === (state.carrier ?? null)))
    ) {
      return { ok: true };
    }
    if (
      (command.mode === "doll" || command.mode === "protocol") &&
      broken.includes(command.device)
    ) {
      return { ok: false, reason: "损坏的行为芯片无法切入托管或改装协议" };
    }
    if (
      (command.mode === "doll" || command.mode === "protocol") &&
      Object.entries(states).some(
        ([id, other]) =>
          id !== command.device && (other.mode === "doll" || other.mode === "protocol"),
      )
    ) {
      return { ok: false, reason: "本人已有另一件行为芯片正在运行，请先切回清醒" };
    }

    const prevMode = state.mode;
    if (command.mode === "off") {
      if (state.lastControl && state.lastControl.to === null) state.lastControl.to = now;
      if (prevMode === "doll" && profile.recall === "none") {
        state.memoryGap = true;
      }
      state.protocol = null;
      state.carrier = null;
    } else if (command.mode === "doll") {
      state.protocol = null;
      state.carrier = null;
      state.lastControl = { from: now, to: null, mode: "doll" };
    } else if (command.mode === "protocol") {
      state.protocol = command.protocol ?? null;
      state.carrier = command.carrier ?? null;
      state.lastControl = { from: now, to: null, mode: "protocol" };
    } else if (command.mode === "glitch") {
      if (!state.lastControl || state.lastControl.to !== null) {
        state.lastControl = { from: now, to: null, mode: "glitch" };
      }
    }

    state.mode = command.mode;
    state.since = now;
    states[command.device] = state;

    const note =
      command.mode === "off"
        ? prevMode === "doll" && profile.recall === "none"
          ? "切回清醒（off）；保留托管时段的记忆断层，除非查阅设备日志或由他人告知"
          : "行为芯片已切回清醒（off）"
        : command.mode === "doll"
          ? "已切入玩偶托管（doll）；本人意识退居后台，安全词可随时中止"
          : command.mode === "protocol"
            ? `已刷入改装协议（protocol）：${state.protocol}`
            : `行为芯片出现异常（glitch）${command.reason ? `：${command.reason}` : ""}`;
    return { ok: true, notes: [note] };
  }

  if (broken.includes(command.device)) {
    return { ok: false, reason: "损坏的行为芯片当前无法记录或读取本地摘要" };
  }
  if (!command.log) return { ok: false, reason: "设备摘要需要稳定 log id" };

  if (command.action === "log") {
    if (profile.logging === "none") {
      return { ok: false, reason: "这件芯片没有本地摘要记录能力" };
    }
    if (!command.text) return { ok: false, reason: "设备摘要需要实际记录的 text" };
    const existing = state.logs.find((entry) => entry.id === command.log);
    if (existing) {
      return existing.text === command.text
        ? { ok: true }
        : { ok: false, reason: "已有设备摘要原文固定，不能改写" };
    }
    if (state.mode === "off") {
      return { ok: false, reason: "芯片处于清醒待机（off），普通交谈不自动写入设备日志" };
    }
    state.logs.push({ id: command.log, text: command.text, at: now, reviewedAt: null });
    states[command.device] = state;
    return { ok: true };
  }

  // review
  if (state.mode !== "off") {
    return { ok: false, reason: "须先切回清醒（off），才能由本人查阅设备日志" };
  }
  const entry = state.logs.find((log) => log.id === command.log);
  if (!entry) return { ok: false, reason: "没有这段实际留下的设备摘要" };
  entry.reviewedAt ??= now;
  states[command.device] = state;
  return { ok: true, notes: ["本人查阅了设备摘要；得知日志内容不等于恢复当时的亲历记忆"] };
}

export function behaviorChipSummary(
  installed: readonly string[],
  states: Readonly<Record<string, BehaviorChipState>> | undefined,
  catalog: ReadonlyMap<string, CyberwareDef>,
): {
  readonly device: string;
  readonly name: string;
  readonly mode: BehaviorChipMode;
  readonly label: string;
  readonly protocol: string | null;
  readonly memoryGap: boolean;
} | null {
  for (const device of installed) {
    const def = catalog.get(device);
    if (!def?.behaviorChip) continue;
    const state = states?.[device];
    const mode: BehaviorChipMode = state?.mode ?? "off";
    return {
      device,
      name: def.name,
      mode,
      label: BEHAVIOR_CHIP_MODE_LABELS[mode],
      protocol: state?.protocol ?? null,
      memoryGap: state?.memoryGap ?? false,
    };
  }
  return null;
}

export function behaviorChipLines(
  installed: readonly string[],
  states: Readonly<Record<string, BehaviorChipState>> | undefined,
  catalog: ReadonlyMap<string, CyberwareDef>,
  query = "",
): string[] {
  return installed.flatMap((device) => {
    const def = catalog.get(device);
    const profile = def?.behaviorChip;
    if (!profile) return [];
    const state = states?.[device];
    const mode: BehaviorChipMode = state?.mode ?? "off";
    const last = state?.lastControl;
    const logs = state?.logs ?? [];
    const terms = query.match(/[\p{Script=Han}]{2,}|[a-zA-Z0-9-]{3,}/gu) ?? [];
    const ranked = logs.map((entry, index) => ({
      entry,
      index,
      score:
        (query.includes(entry.id) ? 100 : 0) +
        terms.reduce((score, term) => {
          if (entry.text.includes(term)) return score + 10;
          for (let i = 0; i + 2 <= term.length; i += 2)
            if (entry.text.includes(term.slice(i, i + 2))) score += 1;
          return score;
        }, 0),
    }));
    const selected = new Set(
      ranked
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, 5)
        .map((entry) => entry.index),
    );
    for (let index = Math.max(0, logs.length - 3); index < logs.length; index++)
      selected.add(index);
    return [
      `行为芯片 ${device}（${def.name}）：${profile.purpose}；当前状态：${BEHAVIOR_CHIP_MODE_LABELS[mode]}（${mode}）${state?.protocol ? `，运行协议「${state.protocol}」` : ""}${state?.memoryGap ? "，存在托管记忆断层" : ""}${profile.safeword ? `；安全词「${profile.safeword}」` : ""}；托管时本人${profile.awareness === "present" ? "保持意识" : "意识退居后台"}，事后${profile.recall === "retained" ? "保留记忆" : "不保留亲历记忆"}${last ? `；最近运行区间 ${last.from}—${last.to ?? "运行中"}` : ""}。`,
      ...(logs.length > selected.size
        ? [`设备共保留 ${logs.length} 段真实摘要，以下是最近与本轮相关部分；其他原文仍持久保存。`]
        : []),
      ...ranked
        .filter(({ index }) => selected.has(index))
        .map(
          ({ entry }) =>
            `设备摘要 ${device}/${entry.id}：${entry.text}；记录于 ${entry.at}；${entry.reviewedAt === null ? "本人未查阅，不属于本人所知" : `本人于 ${entry.reviewedAt} 查阅，仅从日志得知，不是亲历`}。`,
        ),
    ];
  });
}
