import { projectState } from "../../game";
import type { LlmMessage } from "../../kernel/ports";
import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
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
不能加新条目，不能改类型、对象和 id，不能把数值改大；拿不准的 keep。world 只看时间和地点对不对得上正文。`;

/** L3 */
export const VERIFY_OUTPUT = `【输出格式】
只输出一个 <patch> 块，一行一条：
- keep 编号
- drop 编号 ; 原因
- fix 编号 字段=值 ; 原因

例：
<patch>
keep 1
fix 2 tier=graze ; 正文写的是子弹擦过手臂
drop 3 ; 阿宏只说要考虑，没答应
</patch>`;

const VERIFY_SYSTEM = [BOOKKEEPING_BASE, VERIFY_STAGE, VERIFY_OUTPUT].join("\n\n");

/** ⑤ 核对：辅助模型逐条看提议有没有正文依据，只输出 <patch> */
export function buildVerifyPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  plan: NarratorPlan,
  extras: PromptExtras,
  narrative: string,
  proposals: readonly unknown[],
): LlmMessage[] {
  const view = projectState(world, records, extras.data);
  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(view)}`,
      ...(plan.kind === "resolve" ? [checkResultText(plan.check)] : []),
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
