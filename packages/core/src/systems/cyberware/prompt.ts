import type { RuleModule } from "../../kernel/system";
import { ATTRIBUTE_LABELS } from "../dice";
import { RARITY_LABELS } from "../economy";
import { cyberwareCatalog } from "./apply";
import { type CyberwareState, SLOT_LABELS } from "./schema";

export const cyberwareRules: RuleModule<CyberwareState> = {
  id: "cyberware",
  title: "义体",
  commands: ["cyberware"],
  when: () => true,
  text: `- 【当前状态】里的「义体」是角色身上真的装着的东西，写着的能力角色真的做得到：装着螳螂刀就能爬墙，装着义眼就能扫描，不用再问；没装的义体角色做不到。
- 给建议选项时想想装着的义体能开出什么路子。
- 找义体医生装、卸义体时写 cyberware；id 只能用【义体表】里的，价钱照表，谈下来的价或剧情里白送的写 price（白送写 0）。钱不够就装不上，正文里写成讨价还价、赊账被拒或者另想办法。
- 同一部位只装一件，装新的会换下旧的；人性上限由代码按装着的义体算，不另写 humanity。
- 只有义体医生能装卸义体；街上捡到、从敌人身上拆下的义体只写在正文里，要装得先找医生。`,
};

/** 义体表：和物品表一样放在系统提示词末尾，按部位分组 */
export function cyberwareSection(data: Readonly<Record<string, unknown>>): string | undefined {
  const parts = [...cyberwareCatalog(data).values()];
  if (parts.length === 0) return undefined;
  const groups = new Map<string, string[]>();
  for (const p of parts) {
    const notes = [
      RARITY_LABELS[p.rarity],
      p.iconic ? "不朽" : String(p.price),
      `人性-${p.humanityCost}`,
      ...(p.checks.length > 0
        ? [`利于${p.checks.map((a) => ATTRIBUTE_LABELS[a]).join("、")}`]
        : []),
    ];
    const group = SLOT_LABELS[p.slot];
    groups.set(group, [
      ...(groups.get(group) ?? []),
      `- ${p.id} ${p.name}｜${notes.join("｜")}：${p.ability}`,
    ]);
  }
  const body = [...groups].map(([group, lines]) => `${group}\n${lines.join("\n")}`).join("\n");
  return `【义体表】
cyberware 指令的 id 只能用下面这些，正文里用名称。
每行是：id 名称｜稀有度｜参考价（欧元）｜装上后人性上限降多少｜利于哪些属性：能力。“利于”的属性检定里用得上这件义体时算有利条件；不朽义体只从剧情获得，义体医生不卖。
${body}`;
}
