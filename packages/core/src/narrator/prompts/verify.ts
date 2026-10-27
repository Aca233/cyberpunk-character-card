import type { LlmMessage } from "../../kernel/ports";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { NpcStateSchema } from "../../systems/npc";
import {
  checkResultText,
  formatInput,
  type NarratorPlan,
  type PromptExtras,
  stateSummary,
} from "./context";
import { BOOKKEEPING_BASE, userMessage } from "./layers";

/** ⑤ 核对：辅助模型，温度最低，只输出 <patch> */
export const VERIFY_TEMPERATURE = 0.1;

/** L1 */
export const VERIFY_STAGE = `【这一步：核对】
下面给出玩家输入、定稿的正文和从正文里抽出来的提议（带编号）。逐条看正文里有没有依据：
- 正文里有依据的 keep。
- 正文里没有发生，或者只是打算、威胁、玩家角色心里想的，drop 并写原因。
- 发生了但写重了的，按正文改小（伤害档位降一档、数量改对），fix 并写原因。
不能加新条目，不能改类型、对象和 id，不能把数值改大；拿不准的 keep。world 只看时间和地点对不对得上正文。

再审一遍正文守不守守则，发现问题写 flag。flag 只是提醒，不算条目，也不影响上面的 keep、drop、fix：
- 代说：正文替玩家角色说了玩家输入里没有的台词，或者替角色做了决定、写了角色心里的想法和感受。玩家要做的事按【当前状态】做不到（身上没有那件东西、没装那件义体），正文让世界拒绝或换个结果，这是照规矩写，不算代说。
- 泄密：正文把【守则参考】里人物的秘密说破了，而玩家角色没有亲眼看到、也没人告诉他。
- 死人：【守则参考】里已经死了的人在正文里活着出场、说话（回忆、照片、录音不算）。
没有问题就不写 flag，拿不准的也不写。`;

/** L3 */
export const VERIFY_OUTPUT = `【输出格式】
只输出一个 <patch> 块，一行一条：
- keep 编号
- drop 编号 ; 原因
- fix 编号 字段=值 ; 原因
- flag 代说|泄密|死人 ; 说明（引正文里的原话）

例：
<patch>
keep 1
fix 2 tier=graze ; 正文写的是子弹擦过手臂
drop 3 ; 阿宏只说要考虑，没答应
flag 代说 ; 正文写了「你笑着说：钱呢？」，玩家没写这句
</patch>`;

const VERIFY_SYSTEM = [BOOKKEEPING_BASE, VERIFY_STAGE, VERIFY_OUTPUT].join("\n\n");

/** 审守则时对照的人：谁已经死了、活着的人各有什么秘密 */
const MAX_SECRETS = 12;

function rulesReference(world: WorldState): string[] {
  const npcs = Object.values(NpcStateSchema.parse(world.slices.npc ?? { npcs: {} }).npcs);
  const dead = npcs.filter((n) => !n.alive).map((n) => n.name);
  const secrets = npcs
    .filter((n) => n.alive && n.secret)
    .slice(0, MAX_SECRETS)
    .map((n) => `- ${n.name}：${n.secret}`);
  if (dead.length === 0 && secrets.length === 0) return [];
  const lines: string[] = [];
  if (dead.length > 0) lines.push(`已经死了：${dead.join("、")}`);
  if (secrets.length > 0) lines.push(`人物的秘密（只有你知道）：\n${secrets.join("\n")}`);
  return [`【守则参考】\n${lines.join("\n")}`];
}

/** ⑤ 核对：辅助模型逐条看提议有没有正文依据，只输出 <patch> */
export function buildVerifyPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
  extras: PromptExtras,
  narrative: string,
  proposals: readonly unknown[],
): LlmMessage[] {
  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(world, records, extras.data)}`,
      ...(plan.kind === "resolve" ? [checkResultText(plan.check)] : []),
      ...rulesReference(world),
    ],
    input: `【玩家输入】\n${formatInput(plan.input)}`,
    after: [
      `【本轮正文】\n${narrative}`,
      `【提议】\n${proposals.map((p, i) => `${i + 1}. ${JSON.stringify(p)}`).join("\n")}`,
    ],
    reminder: "（只输出 <patch> 块。）",
  });
  return [
    { role: "system", content: VERIFY_SYSTEM },
    { role: "user", content },
  ];
}
