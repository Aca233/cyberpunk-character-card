import { projectState } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { resolveDynamicWordCountBudget } from "../../physics";
import { InventoryStateSchema } from "../../systems/inventory/schema";
import { memoryRecords } from "../../systems/memory";
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
import {
  BASE_CONSTRAINTS,
  DEFAULT_WORLD_STYLE,
  estimateTokens,
  systemMessage,
  userMessage,
} from "./layers";

/**
 * ③ 写正文：纯文本，边收边放。
 * - 当玩家启用酒馆预设时，文风、段落与篇幅完全服从预设；未启用时按场景烈度给出柔性节律引导。
 * - 系统层保持静态可缓存前缀，变动的节奏引导放在本轮用户输入尾端。
 */

/** L1：正文阶段的事实、权限与协议要求，和文风预设职责分开。 */
export const NARRATE_STAGE = `【这一步：写正文】
定性物理裁决、安防约束、出行耗时和到达由代码与判断步先行锚定，状态记账在你写完正文后由代码抽取。【本轮已定的事】与【物理与安防现状】里的硬约束（余额不足、城区门禁、气隙隔离、伤势局限、物理阻断）必须严格落地；其余素材（对手打算、路上所见）按当前局面自然揉进叙事，必要时可顺应情境调整。

【人物与事实】
- 人物卡的说话方式、台词样本、经历、关系、诉求和底线属于这个人的身份与处境；文风偏好不能把不同人物改成同一性格，也不能改写玩家原话。
- 只写确实发生的物理后果：受伤才写疼痛，设备受干扰才写异常，门禁确有条件才写阻拦。不把示例中的伤残、警报或敌意当作本轮事实。

【玩家角色边界】
- 玩家写了台词时，用引号一字不改、不润色地原话保留，再写别人听完怎么反应。
- 绝不替玩家角色说话、做决定或编造内心独白；只写旁人和环境的反馈，以及身体受刺激的生理反应。
- 括号或“我心想”里的念头 NPC 听不见；正文不列编号选项或向玩家发出系统式行动询问。
- 【本轮已定的事】标明“场外提问”时，客观回答问题，不推进剧情、不写游戏数值。

【时间流逝】
- 经过的时间与实际行动一致，尊重玩家选择的等待、睡眠和长途移动。约定、委托可以在其间自然逾期，不因任务节点强制停时；只有有前因且角色实际感知、确会中断行动的事件才中断。`;

/** 未启用写作预设时才添加；不把本作默认文风叠到用户预设上。 */
export const DEFAULT_NARRATE_STYLE = `【默认正文表达】
- 按场面需要选择感官细节，简短交流可以只写台词和动作。
- 避免空泛套话、重复修辞和段末说教。【最近用过的写法】只作修辞参考；事实、玩家原话、人物惯用语与物件名称保持准确。`;

/** L3：纯文本 */
export const NARRATE_OUTPUT = "【输出】\n只输出正文本身：纯文本，不加标题、标签、JSON 和编号选项。";

const narrateCore = new Map<boolean, string>();

/** 预设负责文笔；本作始终提供世界边界与输出协议，无预设时补默认表达和示例。 */
export function coreRules(hasPreset = false): string {
  const cached = narrateCore.get(hasPreset);
  if (cached !== undefined) return cached;
  const rules = [
    BASE_CONSTRAINTS,
    NARRATE_STAGE,
    ...(!hasPreset ? [DEFAULT_WORLD_STYLE, DEFAULT_NARRATE_STYLE, examplesSection()] : []),
    NARRATE_OUTPUT,
  ].join("\n\n");
  narrateCore.set(hasPreset, rules);
  return rules;
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

/** 重复修辞参考；稳定名称与当前讨论的术语豁免，不禁止故事所需的重复事实。 */
export function proseHabits(
  texts: readonly string[],
  stableTerms: readonly string[] = [],
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
      if (stableTerms.some((n) => n.includes(gram) || (n.length >= 2 && gram.includes(n))))
        continue;
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
    if (stableTerms.some((term) => term.length >= 2 && phrase.includes(term))) continue;
    repeats.push(phrase);
  }
  if (openings.length < 2 && repeats.length === 0) return undefined;
  const lines = ["【最近用过的写法】"];
  if (openings.length >= 2)
    lines.push(`最近几轮的开头：${openings.map((o) => `「${o}」`).join("")}`);
  if (repeats.length > 0) lines.push(`可能重复的修辞：${repeats.map((r) => `「${r}」`).join("")}`);
  lines.push(
    "只调整无意义的重复修辞；人名、地点、物件名称、必要事实、玩家原话和人物惯用语照常保留，不为换词改变指代。",
  );
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
  records = memoryRecords(world, records);
  const view = projectState(world, records, extras.data);
  const modules = registry.activeRules(world, plan.input);
  const rules = systemMessage("narrate", [coreRules(extras.hasPreset)], modules);
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
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const names = [
    view.character.name ?? "",
    ...Object.values(npcs.npcs).flatMap((n) => [n.name, n.alias ?? ""]),
    ...Object.values(inventory.objects).map((object) => object.definition.name),
    ...["items", "cyberware", "locations", "factions", "quickhacks"].flatMap((key) =>
      Array.isArray(extras.data?.[key])
        ? (extras.data[key] as unknown[]).flatMap((entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "name" in entry &&
            typeof entry.name === "string"
              ? [entry.name]
              : [],
          )
        : [],
    ),
  ].filter((n) => n !== "");
  const recap = recapFor(world, records, hot, extras.recapTokens);
  const scene = situation(world, records, view, plan, extras);
  const recall = recalledSection(extras.recalled);
  const pacingHint = extras.hasPreset
    ? ""
    : resolveDynamicWordCountBudget(extras.intensity ?? "dialogue").directive.replace(/^- /, "");
  const content = userMessage({
    recap,
    scene,
    decided: extras.decided,
    recall,
    lore: extras.lore,
    habits: extras.hasPreset
      ? undefined
      : proseHabits(
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
