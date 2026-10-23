import { type Command, diceRules, type GmPlan, type GmTurn } from "@cp/core";
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

export function codeFindings(c: EvalCase, plan: GmPlan, turn: GmTurn): Finding[] {
  const out: Finding[] = [];
  const blockDrops = turn.dropped.filter((d) => d.where === "指令块");
  out.push(
    finding(
      "指令块",
      blockDrops.map((d) => d.reason),
    ),
  );
  out.push(
    finding(
      "逐条格式",
      turn.dropped
        .filter((d) => d.stage === "format" && d.where !== "指令块")
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

  const { check } = c.expect;
  if (check === "required")
    out.push(finding("给出检定", turn.check ? [] : ["这一轮应当给出 check"]));
  if (check === "forbidden") {
    out.push(finding("不该掷骰", turn.check ? [`给了 check：${turn.check.intent}`] : []));
  }

  const keys = new Set(turn.commands.flatMap(commandKeys));
  const { require, forbid } = c.expect.commands;
  if (require.length > 0 || forbid.length > 0) {
    out.push(
      finding("指令", [
        ...require.filter((k) => !keys.has(k)).map((k) => `缺少 ${k}`),
        ...forbid.filter((k) => keys.has(k)).map((k) => `不该有 ${k}`),
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
