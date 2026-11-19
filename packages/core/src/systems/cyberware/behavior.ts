import type { ApplyOutcome } from "../../kernel/system";
import { tradeEvidence } from "../commerce";
import type { BehaviorChipState, BehaviorChipTerms, CyberwareDef } from "./schema";

/** 行为模式和设备摘要只记实际事实；不处理收费、人物关系或完整录制。 */
export function applyBehaviorChip(
  states: Record<string, BehaviorChipState>,
  installed: readonly string[],
  command: BehaviorChipTerms,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  facts: Readonly<Record<string, unknown>>,
  broken: readonly string[] = [],
): ApplyOutcome {
  const def = catalog.get(command.device);
  if (!def?.behaviorChip || !installed.includes(command.device))
    return { ok: false, reason: "本人没有实际安装这件行为芯片，获得或读取载体不能启动它" };
  if (!tradeEvidence(facts, command.evidence))
    return { ok: false, reason: "行为芯片变化缺少本轮实际发生的正文依据" };
  const previous = states[command.device];
  const state = previous ?? { mode: "personal" as const, since: now, logs: [] };
  if (command.action === "mode") {
    if (!command.mode) return { ok: false, reason: "切换行为模式需要 mode" };
    if (command.mode === state.mode) return { ok: true };
    if (command.mode === "chip") {
      if (broken.includes(command.device)) return { ok: false, reason: "损坏的行为芯片不能启用" };
      if (!command.consent || !tradeEvidence(facts, command.consent))
        return {
          ok: false,
          reason: "启用前需要本人明确接受本次范围的实际原话，付款或接管中的迎合不能代替",
        };
      if (Object.values(states).some((other) => other.mode === "chip"))
        return { ok: false, reason: "本人已有其他行为芯片接管，先按实际情况退出" };
      state.lastControl = { from: now, to: null };
    } else if (state.lastControl) state.lastControl.to = now;
    state.mode = command.mode;
    state.since = now;
    states[command.device] = state;
    return {
      ok: true,
      notes: [
        command.mode === "chip"
          ? "行为芯片已按约定接管"
          : "本人恢复主导；亲历记忆与已有设备摘要按原条件保留",
      ],
    };
  }
  if (broken.includes(command.device))
    return { ok: false, reason: "损坏的行为芯片当前无法记录或读取本地摘要" };
  if (!command.log) return { ok: false, reason: "设备摘要需要稳定 log id" };
  if (command.action === "log") {
    if (def.behaviorChip.logging === "none")
      return { ok: false, reason: "这件芯片没有已确立的本地摘要记录能力" };
    if (!command.text) return { ok: false, reason: "设备摘要需要实际记录的 text" };
    const existing = state.logs.find((entry) => entry.id === command.log);
    if (existing)
      return existing.text === command.text
        ? { ok: true }
        : { ok: false, reason: "已有设备摘要原文固定，不能重试时改写" };
    if (state.mode !== "chip")
      return { ok: false, reason: "当前没有芯片接管过程可记录；普通交谈不自动生成设备日志" };
    state.logs.push({ id: command.log, text: command.text, at: now, reviewedAt: null });
    states[command.device] = state;
    return { ok: true };
  }
  if (state.mode !== "personal")
    return { ok: false, reason: "本人尚未恢复主导，芯片读取不能冒充本人查阅" };
  const entry = state.logs.find((log) => log.id === command.log);
  if (!entry) return { ok: false, reason: "没有这段实际留下的设备摘要" };
  entry.reviewedAt ??= now;
  states[command.device] = state;
  return { ok: true, notes: ["本人查阅了已有设备摘要；得知记录内容不等于恢复当时的亲历记忆"] };
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
      `行为芯片 ${device}（${def.name}）：${profile.purpose}；当前${state?.mode === "chip" ? "芯片按已约定范围接管" : "本人主导"}；接管时本人${profile.awareness === "present" ? "有意识" : "无当时意识"}；事后${profile.recall === "retained" ? "保留亲历记忆" : "不保留亲历记忆"}；${profile.logging === "none" ? "无本地摘要日志" : "仅实际记录才有本地摘要，不是超梦或内心读取"}${last ? `；最近接管区间 ${last.from}—${last.to ?? "仍在接管"}` : ""}。`,
      ...(logs.length > selected.size
        ? [
            `设备共保留 ${logs.length} 段真实摘要，以下是最近与本轮相关部分；其他原文仍持久保存，可按日志 id 或内容提起。`,
          ]
        : []),
      ...ranked
        .filter(({ index }) => selected.has(index))
        .map(
          ({ entry }) =>
            `设备摘要 ${device}/${entry.id}：${entry.text}；记录于 ${entry.at}；${entry.reviewedAt === null ? "本人未查阅，不属于本人所知" : `本人于 ${entry.reviewedAt} 查阅，仅从日志得知，不是亲历`}；不向其他人自动共享。`,
        ),
    ];
  });
}
