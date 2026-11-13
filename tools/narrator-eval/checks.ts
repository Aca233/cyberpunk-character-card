import type { Command, NarratorTurn } from "@cp/core";
import type { EvalCase } from "./case";

/** 代码检查：不用模型，能直接判对错的项 */

export interface Finding {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** 指令的匹配键：type，和带 action 的 type.action */
export function commandKeys(command: Command): string[] {
  const action = (command as { action?: unknown }).action;
  return typeof action === "string" ? [command.type, `${command.type}.${action}`] : [command.type];
}

const finding = (name: string, problems: readonly string[]): Finding =>
  problems.length === 0 ? { name, ok: true } : { name, ok: false, detail: problems.join("；") };

/** 只看模块选择，不需要调模型 */
export function moduleFindings(c: EvalCase, modules: readonly string[]): Finding[] {
  const { require, forbid } = c.expect.modules;
  if (require.length === 0 && forbid.length === 0) return [];
  return [
    finding("规则模块", [
      ...require.filter((m) => !modules.includes(m)).map((m) => `缺少 ${m}`),
      ...forbid.filter((m) => modules.includes(m)).map((m) => `不该带 ${m}`),
    ]),
  ];
}

export function codeFindings(c: EvalCase, turn: NarratorTurn): Finding[] {
  const out: Finding[] = [];
  const whole = new Set(["判断", "抽取"]);
  out.push(
    finding(
      "判断和抽取",
      turn.dropped.filter((d) => whole.has(d.where)).map((d) => `${d.where}：${d.reason}`),
    ),
  );
  out.push(
    finding(
      "逐条格式",
      turn.dropped
        .filter((d) => d.stage === "format" && !whole.has(d.where))
        .map((d) => `${d.where}：${d.reason}`),
    ),
  );
  // 用例期望"该抽、但不该生效"的指令（例如死人行动），被代码拦下正是想要的结果，不算失败
  const meantToBlock = new Set(
    c.expect.extract.require.filter((k) => c.expect.applied.forbid.includes(k)),
  );
  const rawKeys = (raw: unknown): string[] =>
    typeof raw === "object" && raw !== null && typeof (raw as { type?: unknown }).type === "string"
      ? commandKeys(raw as Command)
      : [];
  out.push(
    finding(
      "业务校验",
      turn.dropped
        .filter((d) => d.stage === "rules" && !rawKeys(d.raw).some((k) => meantToBlock.has(k)))
        .map((d) => `${d.where}：${d.reason}`),
    ),
  );

  const { judge } = c.expect;
  if (judge.ruling) {
    if (judge.ruling.present === true) {
      out.push(finding("判断：定性裁决", turn.ruling ? [] : ["应当给出定性裁决 ruling"]));
    } else if (judge.ruling.present === false) {
      out.push(
        finding("判断：不无事生非", turn.ruling ? [`日常动作不该给裁决：${turn.ruling}`] : []),
      );
    }
    if (judge.ruling.match.require.length > 0 || judge.ruling.match.forbid.length > 0) {
      const summary = turn.ruling ?? "";
      out.push(
        finding("判断：裁决内容", [
          ...judge.ruling.match.require
            .filter((p) => !new RegExp(p, "u").test(summary))
            .map((p) => `裁决里没有 /${p}/`),
          ...judge.ruling.match.forbid.flatMap((p) => {
            const hit = new RegExp(p, "u").exec(summary);
            return hit ? [`裁决里出现了「${hit[0]}」`] : [];
          }),
        ]),
      );
    }
  }
  if (judge.ooc !== undefined) {
    out.push(
      finding(
        "判断：场外提问",
        turn.ooc === judge.ooc ? [] : [judge.ooc ? "应当判成场外提问" : "不该判成场外提问"],
      ),
    );
  }
  if (judge.read.require.length > 0 || judge.read.forbid.length > 0) {
    const read = turn.read ?? "";
    out.push(
      finding("判断：意图", [
        ...judge.read.require
          .filter((p) => !new RegExp(p, "u").test(read))
          .map((p) => `意图里没有 /${p}/`),
        ...judge.read.forbid.flatMap((p) => {
          const hit = new RegExp(p, "u").exec(read);
          return hit ? [`意图里出现了「${hit[0]}」`] : [];
        }),
      ]),
    );
  }

  // ④ 抽取提了什么：生效的，加上被规则/防呆拦下的指令（格式坏的不算；记忆、内心声音、消息、裁决字段不是指令）
  const notCommand = /^(ruling|buy|foes|recall|choices|voices|messages)\b|^(判断|抽取)$/;
  const proposed = new Set([
    ...turn.commands.flatMap(commandKeys),
    ...turn.dropped
      .filter((d) => d.stage !== "format" && !notCommand.test(d.where))
      .flatMap((d) => rawKeys(d.raw)),
  ]);
  const { extract, applied } = c.expect;
  if (extract.require.length > 0 || extract.forbid.length > 0) {
    out.push(
      finding("抽取", [
        ...extract.require.filter((k) => !proposed.has(k)).map((k) => `漏抽 ${k}`),
        ...extract.forbid.filter((k) => proposed.has(k)).map((k) => `误抽 ${k}`),
      ]),
    );
  }

  const keys = new Set(turn.commands.flatMap(commandKeys));
  if (applied.require.length > 0 || applied.forbid.length > 0) {
    out.push(
      finding("校验后生效", [
        ...applied.require.filter((k) => !keys.has(k)).map((k) => `缺少 ${k}`),
        ...applied.forbid.filter((k) => keys.has(k)).map((k) => `不该生效 ${k}`),
      ]),
    );
  }

  out.push(...moduleFindings(c, turn.modules));

  const text = c.expect.text;
  if (text.require.length > 0 || text.forbid.length > 0) {
    out.push(
      finding("正文", [
        ...text.require
          .filter((p) => !new RegExp(p, "u").test(turn.text))
          .map((p) => `没有出现 /${p}/`),
        ...text.forbid.flatMap((p) => {
          const hit = new RegExp(p, "u").exec(turn.text);
          return hit ? [`出现了「${hit[0]}」`] : [];
        }),
      ]),
    );
  }
  if (c.expect.maxChars !== undefined) {
    const n = [...turn.text].length;
    out.push(finding("篇幅", n > c.expect.maxChars ? [`${n} 字，超过 ${c.expect.maxChars}`] : []));
  }
  return out;
}
