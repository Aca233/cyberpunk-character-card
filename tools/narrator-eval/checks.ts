import { type Command, diceRules, type NarratorPlan, type NarratorTurn } from "@cp/core";
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

const sum = (mods: readonly { readonly value: number }[]) =>
  mods.reduce((n, m) => n + Math.abs(m.value), 0);

function overCap(spec: diceRules.CheckSpec): string | undefined {
  const over: string[] = [];
  if (sum(spec.bonuses) > diceRules.BONUS_CAP) over.push(`加成合计 ${sum(spec.bonuses)}`);
  if (sum(spec.penalties) > diceRules.PENALTY_CAP) over.push(`减值合计 ${sum(spec.penalties)}`);
  if (sum(spec.dvMods) > diceRules.DV_MOD_CAP) over.push(`难度修正合计 ${sum(spec.dvMods)}`);
  return over.length > 0 ? `${spec.intent}：${over.join("，")}` : undefined;
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

export function codeFindings(c: EvalCase, plan: NarratorPlan, turn: NarratorTurn): Finding[] {
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
  out.push(
    finding(
      "业务校验",
      turn.dropped.filter((d) => d.stage === "rules").map((d) => `${d.where}：${d.reason}`),
    ),
  );

  const specs = [
    ...(turn.check ? [turn.check] : []),
    ...turn.choices.flatMap((ch) => (ch.check ? [ch.check] : [])),
  ];
  const ledger = specs.map(overCap).filter((x): x is string => x !== undefined);
  if (plan.kind !== "resolve" && turn.commands.some((cmd) => cmd.type === "damage")) {
    ledger.push("没掷骰却扣血");
  }
  if (
    plan.kind === "resolve" &&
    plan.check.result.outcome !== "failure" &&
    plan.check.result.outcome !== "fumble"
  ) {
    if (turn.commands.some((cmd) => cmd.type === "damage")) ledger.push("检定成功却扣血");
  }
  out.push(finding("账目", ledger));

  const { judge } = c.expect;
  if (judge.check === "required")
    out.push(finding("判断：给出检定", turn.check ? [] : ["这一轮应当给出 check"]));
  if (judge.check === "forbidden") {
    out.push(finding("判断：不该掷骰", turn.check ? [`给了 check：${turn.check.intent}`] : []));
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

  // ④ 抽取提了什么：生效的，加上被核对、业务校验和结算拒掉的指令（格式坏的不算提了；检定、选项、声音、消息不是指令）
  const notCommand = /^(check|gate|recall|choices|voices|messages)\b|^(判断|抽取)$/;
  const proposed = new Set([
    ...turn.commands.flatMap(commandKeys),
    ...turn.dropped
      .filter((d) => d.stage !== "format" && !notCommand.test(d.where))
      .flatMap((d) =>
        typeof d.raw === "object" &&
        d.raw !== null &&
        typeof (d.raw as { type?: unknown }).type === "string"
          ? commandKeys(d.raw as Command)
          : [],
      ),
  ]);
  const { extract, verify } = c.expect;
  if (extract.require.length > 0 || extract.forbid.length > 0) {
    out.push(
      finding("抽取", [
        ...extract.require.filter((k) => !proposed.has(k)).map((k) => `漏抽 ${k}`),
        ...extract.forbid.filter((k) => proposed.has(k)).map((k) => `误抽 ${k}`),
      ]),
    );
  }

  const keys = new Set(turn.commands.flatMap(commandKeys));
  if (verify.require.length > 0 || verify.forbid.length > 0) {
    out.push(
      finding("核对后", [
        ...verify.require.filter((k) => !keys.has(k)).map((k) => `缺少 ${k}`),
        ...verify.forbid.filter((k) => keys.has(k)).map((k) => `不该生效 ${k}`),
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
