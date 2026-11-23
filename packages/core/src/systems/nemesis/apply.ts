import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import type { CombatState } from "../combat";
import type { NpcState } from "../npc";
import {
  NEMESES_MAX,
  NEMESIS_END_LABELS,
  NEMESIS_RISE_HOURS,
  NEMESIS_STYLE_LABELS,
  type NemesisCommand,
  type NemesisState,
} from "./schema";

type State = Draft<NemesisState>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

// 宿敌隔几天才能动、拖几天必须动的计时删了，什么时候动由【城里在发酵的事】的定时器和主持人定
// （用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）

function rise(draft: State, command: NemesisCommand, ctx: SystemContext): ApplyOutcome {
  const id = command.npc;
  if (draft.nemeses.some((n) => n.npc === id)) return fail(`${id} 已经是宿敌了`);
  if (draft.ended.some((n) => n.npc === id)) return fail(`和 ${id} 的恩怨已经了结了`);
  if (draft.nemeses.length >= NEMESES_MAX) {
    return fail(`宿敌同时最多 ${NEMESES_MAX} 个，先了结一个`);
  }
  const card = ctx.read<NpcState>("npc").npcs[id];
  if (!card) return fail(`没有 ${id} 的人物卡；宿敌只能是有卡的敌人`);
  if (!card.alive) return fail(`${card.name}已经死了`);
  const combat = ctx.read<CombatState>("combat");
  const fleeing = combat.active?.foes.find((f) => f.npc === id && f.state === "fled");
  const last = combat.last;
  const after = last?.foes.find((f) => f.npc === id);
  const recent = last !== null && ctx.now - last.endedAt <= NEMESIS_RISE_HOURS * 60;
  // 逃掉的随时算；打完还活着的算放走了（战斗只记后果，不再分胜负）
  const escaped = fleeing !== undefined || (recent && after?.state === "fled");
  const spared = recent && after !== undefined && after.state !== "dead";
  if (!escaped && !spared) {
    return fail(
      `${card.name}不是刚打完、活着逃掉或被放走的有卡敌人（要在战斗里写进 foes，收场 ${NEMESIS_RISE_HOURS} 小时内升级）`,
    );
  }
  const how = command.how ?? "";
  draft.nemeses.push({
    npc: id,
    name: card.name,
    since: ctx.now,
    how,
    prep:
      command.against && command.prep
        ? { against: command.against, text: command.prep, at: ctx.now }
        : null,
    known: false,
  });
  return { ok: true, notes: [`${card.name}成了你的宿敌：${how}`] };
}

function prep(draft: State, command: NemesisCommand, now: number): ApplyOutcome {
  const n = draft.nemeses.find((x) => x.npc === command.npc);
  if (!n) return fail(`${command.npc} 不是宿敌`);
  if (!command.against || !command.prep) return fail("prep 要写 against 和 prep");
  n.prep = { against: command.against, text: command.prep, at: now };
  n.known = false;
  // 准备是给模型看的；玩家要扫描或打听过才知道，提示里不写内容
  return { ok: true, notes: [`${n.name}在为下次碰面做准备`] };
}

function reveal(draft: State, command: NemesisCommand): ApplyOutcome {
  const n = draft.nemeses.find((x) => x.npc === command.npc);
  if (!n) return fail(`${command.npc} 不是宿敌`);
  if (!n.prep) return fail(`${n.name}还没做什么准备`);
  if (n.known) return { ok: true, notes: [] };
  n.known = true;
  return {
    ok: true,
    notes: [`摸清了${n.name}的准备：专克${NEMESIS_STYLE_LABELS[n.prep.against]}，${n.prep.text}`],
  };
}

function end(draft: State, command: NemesisCommand, ctx: SystemContext): ApplyOutcome {
  const index = draft.nemeses.findIndex((x) => x.npc === command.npc);
  const n = draft.nemeses[index];
  if (!n) return fail(`${command.npc} 不是宿敌`);
  if (!command.end || !command.text) return fail("end 要写 end 和 text");
  const card = ctx.read<NpcState>("npc").npcs[n.npc];
  if (command.end === "killed" && card?.alive !== false) {
    return fail(`${n.name}还活着：杀掉要先写他的死`);
  }
  draft.nemeses.splice(index, 1);
  draft.ended.push({
    npc: n.npc,
    name: n.name,
    since: n.since,
    how: n.how,
    end: command.end,
    text: command.text,
    at: ctx.now,
  });
  return {
    ok: true,
    notes: [`和${n.name}的恩怨了结了：${NEMESIS_END_LABELS[command.end]}`],
  };
}

export function applyNemesis(
  draft: State,
  command: NemesisCommand,
  ctx: SystemContext,
): ApplyOutcome {
  switch (command.action) {
    case "rise":
      return rise(draft, command, ctx);
    case "prep":
      return prep(draft, command, ctx.now);
    case "reveal":
      return reveal(draft, command);
    case "end":
      return end(draft, command, ctx);
  }
}

// 场外动作只记在统一单子的步骤里，宿敌不再另记一份（用户 2026-11-01 定的"全改"第 4 步）
