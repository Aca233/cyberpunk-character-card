import { projectState } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { resolveDynamicWordCountBudget } from "../../physics";
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
  narrateTablesOf,
  type PromptExtras,
  recapFor,
  situation,
} from "./context";
import { BASE_RULES, estimateTokens, systemMessage, userMessage } from "./layers";

/**
 * ③ 写正文：纯文本，边收边放。
 * - 当玩家启用酒馆预设时，文风、段落与篇幅完全服从预设；未启用时按场景烈度给出柔性节律引导。
 * - 系统层保持静态可缓存前缀，变动的节奏引导放在本轮用户输入尾端。
 */

/** 兼容导出：未启用预设时的默认参考提示；实际节律由 resolveDynamicWordCountBudget 给出 */
export const NARRATE_LENGTH =
  "- 篇幅随场面自然伸缩：日常交谈重言外之意，街区踩点带出心理暗流与五感背景，高压冲突写透感官与物理碰撞；对话停在对方递话或局面悬着的瞬间。";

export const NARRATE_LENGTH_PRESET =
  "- 篇幅、段落、对话与描写的比例完全照前面导入的酒馆写作预设展开，不受固定字数限制。";

/** L1：这一步做什么 */
export const NARRATE_STAGE = `【这一步：写正文】
定性物理裁决、安防约束、出行耗时和到达由代码与判断步先行锚定，状态记账在你写完正文后由代码抽取。【本轮已定的事】与【物理与安防现状】里的硬约束（余额不足、城区门禁、气隙隔离、伤势局限、物理阻断）必须严格落地；其余素材（对手打算、路上所见）按当前局面自然揉进叙事，必要时可顺应情境调整。

【人物深度、五感与活态夜之城】
- 写活有血肉的人：人物说话与行动有自己的顾虑、贪念、疲惫、体面与创伤记忆，对话停顿、视线偏移、手下动作都能透出弦外之音；熟人交情深时有温度、肯递台阶，但仍有自己的账要算，不是应声虫。
- 用五感把夜之城铺在呼吸里：潮湿沥青的冷腥味、劣质合成烟丝的焦苦、义眼受干扰时耳膜底下的高频啸叫、门缝透出的低音炮震动、街角路人和全息广告声——让城市成为活的底色，而非真空舞台。
- 物理后果真打真疼：枪弹啃在防弹插板或义体外壳上的顿挫、断肢或失血造成的眩晕与手脚发凉、穿不合场合行头被礼宾抬手拦下的窘迫，都要写进实在的触感里。

【彻底去 AI 味守则】
- 反套话与机械修辞：严禁“空气仿佛凝固”“一丝不易察觉的”“嘴角勾起一抹弧度”“眼中闪过一道光”“时间仿佛静止”“深吸了一口气”“不仅……更……”；禁止三连形容词堆砌（如“冷漠、警惕而又疲倦”）；【最近用过的写法】列出的开头与高频词本轮一律换掉。
- 严禁总结腔与升华说教：事件、动作或台词说完干脆收刀，绝不在段末来一句人生感悟或宏观叹息（严禁“这就是夜之城的生存法则”“在这座冰冷的城市里”“今晚没人能独善其身”）。
- 糙劲口吻与差异化人声：NPC 照各自经历与地位开口，多用短句、反问、冷哼、打断、半截话与适量街头黑话；把书面官腔彻底踢出去。

【玩家角色边界】
- 玩家写了台词时，用引号一字不改、不润色地原话保留，再写别人听完怎么反应。
- 绝不替玩家角色说话、做决定或编造内心独白；只写旁人和环境的反馈，以及身体受刺激的生理反应。
- 括号或“我心想”里的念头 NPC 听不见；结尾绝不列编号选项，不问“你要怎么做？”，停在人物递话或等待反应的瞬间。
- 【本轮已定的事】标明“场外提问”时，跳出角色一两句直白作答，不推进剧情、不写游戏数值。

【时间流逝】
- 经过了多少时间在正文自然交代（“抽完这根烟的功夫”“二十分钟后”“第二天晌午”），睡觉或长途跳过若中途踩到期限/委托节点，写到该节点停下。`;

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
  // 写正文不带对 id 用的表，只带剧情素材（用户 2026-10-31："越来越像游戏而不是角色扮演了"）
  const system = [rules, ...narrateTablesOf(view, extras)].join("\n\n");
  const messages: LlmMessage[] = [{ role: "system", content: system }];
  const hot = extras.history ?? HISTORY_TURNS;
  let history = 0;
  for (const turn of hot > 0 ? view.turns.slice(-hot) : []) {
    const input = formatInput(turn.input);
    messages.push({ role: "user", content: input });
    messages.push({ role: "assistant", content: turn.text });
    history += estimateTokens(input) + estimateTokens(turn.text);
  }
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const names = [
    view.character.name ?? "",
    ...Object.values(npcs.npcs).flatMap((n) => [n.name, n.alias ?? ""]),
  ].filter((n) => n !== "");
  const recap = recapFor(world, records, hot, extras.recapTokens);
  const scene = situation(world, records, view, plan, extras);
  const recall = recalledSection(extras.recalled);
  const pacingHint = extras.hasPreset
    ? "写作节奏：篇幅、段落、对话与描写比例完全按前面导入的酒馆写作预设执行。"
    : resolveDynamicWordCountBudget(extras.intensity ?? "dialogue").directive.replace(/^- /, "");
  const content = userMessage({
    recap,
    scene,
    decided: extras.decided,
    recall,
    lore: extras.lore,
    habits: proseHabits(
      view.turns.map((t) => t.text),
      names,
    ),
    input: formatInput(plan.input),
    after: [boostNote(view, plan, "narrate")],
    reminder: `（${pacingHint}只写正文，纯文本。）`,
  });
  messages.push({ role: "user", content });
  const tokens = (s: string | undefined) => (s === undefined ? 0 : estimateTokens(s));
  const hotTokens = tokens(scene.join("\n\n")) + tokens((extras.decided ?? []).join("\n"));
  const parts = {
    rules: tokens(system),
    history,
    recap: tokens(recap),
    hot: hotTokens,
    expanded: tokens(recall),
    world: tokens(extras.lore),
    other: Math.max(
      0,
      tokens(content) - tokens(recap) - hotTokens - tokens(recall) - tokens(extras.lore),
    ),
  };
  return { messages, modules: modules.map((m) => m.id), rules: rules.length, parts };
}
