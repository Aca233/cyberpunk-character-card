import type { Draft } from "immer";
import { z } from "zod";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { JobsState } from "../jobs";
import {
  BD_ABANDON,
  BD_HISTORY_KEPT,
  type BdConcludeCommand,
  type BdInvestigation,
  type BdMarkCommand,
  BdRecordingSchema,
  type BraindanceCommand,
  type BraindanceState,
  BraindanceStateSchema,
} from "./schema";

type State = Draft<BraindanceState>;
type Data = Readonly<Record<string, unknown>>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 内容包里的示例录像：给叙事模型照着写的样子，也可以直接拿来用 */
export const BdExampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** 什么局面下用得上 */
  when: z.string().trim().min(1).max(80),
  recording: BdRecordingSchema,
  /** 依据的原作任务（文本库 key） */
  refs: z.array(z.string().min(1)).min(1),
  source: z.string().min(1),
});
export type BdExample = z.infer<typeof BdExampleSchema>;

export const BdExampleListSchema = z.array(BdExampleSchema).superRefine((list, ctx) => {
  const ids = new Set<string>();
  for (const e of list) {
    if (ids.has(e.id)) ctx.addIssue({ code: "custom", message: `示例录像 ${e.id} 重复了` });
    ids.add(e.id);
  }
});

const examples = new WeakMap<object, readonly BdExample[]>();

/** 读取并校验示例录像；没有时是空表 */
export function braindanceExamples(data: Data): readonly BdExample[] {
  const raw = data.braindances;
  if (typeof raw !== "object" || raw === null) return [];
  const cached = examples.get(raw);
  if (cached) return cached;
  const list = BdExampleListSchema.parse(raw);
  examples.set(raw, list);
  return list;
}

/** 关键线索找到了几条、一共几条 */
export function keyProgress(inv: BdInvestigation): { found: number; total: number } {
  const keys = inv.recording.points.filter((p) => p.key);
  return { found: keys.filter((p) => inv.marked.includes(p.id)).length, total: keys.length };
}

/** 关键线索都找到了，可以下结论 */
export function canConclude(inv: BdInvestigation): boolean {
  const { found, total } = keyProgress(inv);
  return found === total;
}

/** 回合带了超梦结论时，调模型前先拦：没在查、关键线索没找全、结论 id 不对；能下时返回 undefined */
export function concludeBlock(slice: unknown, option: string): string | undefined {
  const inv = BraindanceStateSchema.parse(slice ?? {}).active;
  if (!inv) return "现在没有在查的超梦";
  if (option === BD_ABANDON) return undefined;
  const { found, total } = keyProgress(inv);
  if (found < total) return `关键线索还没找全（${found}/${total}），还不能下结论`;
  if (!inv.recording.conclusions.some((o) => o.id === option)) return `没有 ${option} 这个结论`;
  return undefined;
}

/** 委托还在进行中才写进展笔记 */
function activeJob(ctx: SystemContext, id: string | undefined): boolean {
  if (id === undefined) return false;
  const jobs = ctx.read<JobsState>("jobs").jobs;
  return jobs.some((j) => j.id === id && j.status === "active");
}

export function applyBraindanceStart(
  draft: State,
  command: BraindanceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.active) {
    return fail(
      `还有一段超梦「${draft.active.recording.title}」没查完，玩家下结论或退出以后才能接下一段`,
    );
  }
  const { recording } = command;
  if (recording.job !== undefined) {
    const job = ctx.read<JobsState>("jobs").jobs.find((j) => j.id === recording.job);
    if (!job) return fail(`没有 id 为 ${recording.job} 的委托`);
    if (job.status !== "active") return fail(`委托「${job.title}」不在进行中`);
  }
  draft.active = { recording, startedAt: ctx.now, marked: [] };
  return {
    ok: true,
    notes: [
      `接上超梦：「${recording.title}」（${recording.recorder}录制），打开超梦体验编辑器查看`,
    ],
  };
}

export function applyBraindanceMark(
  draft: State,
  command: BdMarkCommand,
  _ctx: SystemContext,
): ApplyOutcome {
  const inv = draft.active;
  if (!inv) return fail("现在没有在查的超梦");
  const point = inv.recording.points.find((p) => p.id === command.point);
  if (!point) return fail(`录像里没有 ${command.point} 这个点`);
  if (inv.marked.includes(point.id)) return fail(`「${point.label}」已经标过了`);
  const before = canConclude(inv);
  inv.marked.push(point.id);
  const notes = [`标出线索：${point.label}——${point.scan.conclusion}`];
  if (!before && canConclude(inv)) notes.push("线索够了，可以下结论");
  return { ok: true, notes };
}

export function applyBraindanceConclude(
  draft: State,
  command: BdConcludeCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const inv = draft.active;
  if (!inv) return fail("现在没有在查的超梦");
  const { recording } = inv;
  const { found, total } = keyProgress(inv);
  const abandon = command.option === BD_ABANDON;
  const option = recording.conclusions.find((o) => o.id === command.option);
  if (!abandon) {
    if (found < total) return fail(`关键线索还没找全（${found}/${total}），还不能下结论`);
    if (!option) return fail(`没有 ${command.option} 这个结论`);
  }
  const correct = abandon ? null : command.option === recording.answer;
  draft.history.push({
    title: recording.title,
    recorder: recording.recorder,
    job: recording.job ?? null,
    option: command.option,
    optionText: option?.text ?? null,
    correct,
    keysFound: found,
    keysTotal: total,
    truth: recording.truth,
    startedAt: inv.startedAt,
    at: ctx.now,
  });
  if (draft.history.length > BD_HISTORY_KEPT) {
    draft.history.splice(0, draft.history.length - BD_HISTORY_KEPT);
  }
  draft.active = null;
  const emit: Command[] = [];
  // 委托笔记玩家在日志里看得到，只写结论不写对错；对错记在历史里，只给叙事模型看
  if (activeJob(ctx, recording.job)) {
    emit.push({
      type: "jobNote",
      id: recording.job,
      note: abandon
        ? `超梦「${recording.title}」没查完就退出了`
        : `超梦「${recording.title}」的结论：${option?.text}`,
    });
  }
  // 对错不写进给玩家看的提示，由正文和后果透出来
  return {
    ok: true,
    notes: [
      abandon
        ? `退出超梦「${recording.title}」，没下结论`
        : `超梦「${recording.title}」下了结论：${option?.text}`,
    ],
    emit,
  };
}
