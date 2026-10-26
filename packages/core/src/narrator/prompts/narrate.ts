import { projectState } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { NpcStateSchema } from "../../systems/npc/schema";
import { registry } from "../../systems/registry";
import { examplesSection } from "../examples";
import type { Memory } from "../stages";
import {
  boostNote,
  formatInput,
  HISTORY_TURNS,
  type NarratorPlan,
  type NarratorPrompt,
  type PromptExtras,
  recapFor,
  situation,
  tablesOf,
} from "./context";
import { BASE_RULES, systemMessage, userMessage } from "./layers";

/**
 * ③ 写正文：纯文本，边收边放。温度用设置里叙事模型的温度（规格暂定 0.8），这里不覆盖玩家的设置
 */

/** L1：这一步做什么，带三条守则 */
export const NARRATE_STAGE = `【这一步：写正文】
要不要掷骰、门槛达没达标在你之前由代码定好，记账在你之后由代码从正文里抽；【本轮已定的事】里的结果，正文必须照着写。

【三条守则】
- 反套话：不用“空气仿佛凝固了”“一丝不易察觉的”“嘴角勾起一抹弧度”“眼中闪过一道光”“时间仿佛静止”这类空话和陈词；【最近用过的写法】里列出的开头和词，这一轮换个说法。
- 人物声音：在场人物照【人物】里写的说话方式、口头禅和句子长短开口，说话样本只参考口吻、不照搬；不同的人说话要分得开。
- 边界：不写玩家角色的台词、心理和决定；动作可以展开描写但不加玩家没写的意图；正文结尾不列编号选项（选项由后面一步单独给），玩家要求时才在正文里列。

【入戏】
- 玩家这一轮写了台词时，正文里一定要用引号照原话写出这句（一字不改，不润色，不省略），通常放在开头，再写别人听到后怎么回应；不能跳过玩家的话直接写回应。
- NPC 用自己的声音说话：口癖、街头黑话、情绪和立场都要鲜明。台词是正文的主体，环境和动作描写为对话服务，点到为止。
- 不跳出戏：正文里不问“你要怎么做？”，不总结局势，不提检定、难度、属性和数值，不解释规则。需要玩家回应时，让 NPC 把话递过来，或者停在一个悬着的瞬间。

【玩家输入】
- 玩家只有一个输入框，一次可能同时写了动作、台词和念头，你自己分辨：引号里的、或明显是说出口的话是台词；括号里的、或“我心想”之类是只有角色自己知道的念头，NPC 听不到，不能被当成对话回应；其余按行动理解。拿不准是说出口还是心里想时，按没说出口处理。
- 【本轮已定的事】写了“场外提问”时：跳出角色，用一两句话直接回答，不推进剧情；问“能不能行”时只说大致可行性和有没有风险，不给难度值。

【可信】
- 自由输入是一等公民。先理解玩家想达成什么，合理的办法直接让它发生，并写出代价：时间、人情、痕迹或热度至少付一项。
- 不可能的事让世界或 NPC 拒绝（门锁死了、对方冷笑着摇头）；玩家声称有、资料里找不到的东西，可以让玩家试着“装作有”。

【检定和门槛】
- 【本轮已定的事】写了“先给检定”时：这一轮只写到行动将要发生的那一刻（一两句），不写结果，停笔等玩家确认。
- 有【检定结果】时照事先说明的写：成功就办成，失败后果不比事先说明的更重，剧情照样往前走。
- 门槛达标的直接办成；没达标的让世界或人物拒绝，或者让玩家付出别的代价。

【时间】
- 过了多久在正文里交代出来（“半小时后”“天亮了”）：一句寒暄几十秒，一场谈判半小时，睡到第二天几点也由你写。代码按正文记钟点，时间只往前走。
- 睡觉、等到天黑、长途移动这类长时间跳过，中间有期限或委托到期时，写到那一刻就停，交给玩家；代码也会把时间截在那一刻。

【写作】
- 每轮 100–350 字，等检定的那一轮更短；以对话为主，停在 NPC 说完话、或需要玩家接话的地方。`;

/** L3：纯文本 */
export const NARRATE_OUTPUT = "【输出】\n只输出正文本身：纯文本，不加标题、标签、JSON 和编号选项。";

let narrateCore: string | undefined;

/** ③ 写正文不变的几层：L0、L1、L3 和好坏示例 */
export function coreRules(): string {
  narrateCore ??= [BASE_RULES, NARRATE_STAGE, NARRATE_OUTPUT, examplesSection()].join("\n\n");
  return narrateCore;
}

/** 列开头的轮数、找重复词的轮数、至少几轮里出现才算重复、最多列几个、开头截多长 */
const OPENING_TURNS = 4;
const REPEAT_TURNS = 6;
const REPEAT_MIN = 3;
const MAX_REPEATS = 6;
const OPENING_MAX = 14;
/** 重复词从三字往两边扩，最长这么多字 */
const PHRASE_MAX = 12;
/** 虚词和代词：三字组里有两个以上时不算写法 */
const COMMON = new Set([
  ..."的了是在你我他她它们这那一不有和就也都着把被给说到上下来去个么什没吗呢吧啊又还很",
]);
const HAN3 = /^[㐀-鿿]{3}$/;

function openingOf(text: string): string {
  const first = text.trim().split(/[，。！？…：；、“”「」\n]/)[0] ?? "";
  return [...first].slice(0, OPENING_MAX).join("");
}

/** 反套话：最近几轮正文的开头，和在好几轮里反复出现的三字词；人物名不算 */
export function proseHabits(
  texts: readonly string[],
  names: readonly string[] = [],
): string | undefined {
  const openings = [
    ...new Set(
      texts
        .slice(-OPENING_TURNS)
        .map(openingOf)
        .filter((o) => o.length >= 4),
    ),
  ];
  const counts = new Map<string, number>();
  for (const text of texts.slice(-REPEAT_TURNS)) {
    const chars = [...text];
    const seen = new Set<string>();
    for (let i = 0; i + 3 <= chars.length; i += 1) {
      const gram = chars.slice(i, i + 3).join("");
      if (!HAN3.test(gram)) continue;
      if ([...gram].filter((c) => COMMON.has(c)).length >= 2) continue;
      if (names.some((n) => n.includes(gram) || (n.length >= 2 && gram.includes(n)))) continue;
      seen.add(gram);
    }
    for (const gram of seen) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  const ranked = [...counts]
    .filter(([, n]) => n >= REPEAT_MIN)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const recent = texts.slice(-REPEAT_TURNS);
  const spread = (p: string) => recent.filter((x) => x.includes(p)).length;
  const han = /[㐀-鿿]/;
  const grow = (start: string): string => {
    let phrase = start;
    while ([...phrase].length < PHRASE_MAX) {
      const next = new Set<string>();
      for (const x of recent) {
        const at = x.indexOf(phrase);
        if (at < 0) continue;
        const after = [...x.slice(at + phrase.length)][0];
        const before = [...x.slice(0, at)].reverse()[0];
        if (after && han.test(after)) next.add(phrase + after);
        if (before && han.test(before)) next.add(before + phrase);
      }
      const longer = [...next].find((p) => spread(p) >= REPEAT_MIN);
      if (!longer) break;
      phrase = longer;
    }
    return phrase;
  };
  const repeats: string[] = [];
  for (const [gram] of ranked) {
    if (repeats.length >= MAX_REPEATS) break;
    if (repeats.some((r) => r.includes(gram))) continue;
    const phrase = grow(gram);
    if (repeats.some((r) => r.includes(phrase) || phrase.includes(r))) continue;
    repeats.push(phrase);
  }
  if (openings.length < 2 && repeats.length === 0) return undefined;
  const lines = ["【最近用过的写法】"];
  if (openings.length >= 2)
    lines.push(`最近几轮的开头：${openings.map((o) => `「${o}」`).join("")}`);
  if (repeats.length > 0) lines.push(`反复出现的词：${repeats.map((r) => `「${r}」`).join("")}`);
  lines.push("这一轮换个开头和说法，别再用这些；人物名和地名照常用。");
  return lines.join("\n");
}

/** ① 判断调出的旧记忆，单独一栏 */
function recalledSection(recalled: readonly Memory[] | undefined): string | undefined {
  if (!recalled || recalled.length === 0) return undefined;
  return `【调出的旧记忆】\n${recalled.map((m) => `- ${m.title}\n  ${m.text}`).join("\n")}`;
}

/** ③ 写正文：最近几轮原文作对话历史，最后一条消息按 L2 槽位放局面、本轮已定的事和玩家输入 */
export function buildNarratorPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
  extras: PromptExtras = {},
): NarratorPrompt {
  const view = projectState(world, records, extras.data);
  const modules = registry.activeRules(world, plan.input);
  const rules = systemMessage("narrate", [coreRules()], modules);
  const messages: LlmMessage[] = [
    { role: "system", content: [rules, ...tablesOf(view, extras)].join("\n\n") },
  ];
  for (const turn of view.turns.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: formatInput(turn.input) });
    messages.push({ role: "assistant", content: turn.text });
  }
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const names = [
    view.character.name ?? "",
    ...Object.values(npcs.npcs).flatMap((n) => [n.name, n.alias ?? ""]),
  ].filter((n) => n !== "");
  messages.push({
    role: "user",
    content: userMessage({
      recap: recapFor(world, records, HISTORY_TURNS),
      scene: situation(world, view, plan, extras),
      decided: extras.decided,
      recall: recalledSection(extras.recalled),
      lore: extras.lore,
      habits: proseHabits(
        view.turns.map((t) => t.text),
        names,
      ),
      input: formatInput(plan.input),
      after: [boostNote(view, plan, "narrate")],
      reminder: "（只写正文，纯文本。）",
    }),
  });
  return { messages, modules: modules.map((m) => m.id), rules: rules.length };
}
