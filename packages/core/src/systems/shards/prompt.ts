import type { RuleModule, SectionContext } from "../../kernel/system";
import { type InventoryState, InventoryStateSchema, itemCatalog } from "../inventory";
import type { NpcState } from "../npc";
import { formatGameTime, type WorldClockState } from "../world";
import { chipContentCatalog, readableChipPart } from "./apply";
import { SHARD_KIND_LABELS, type Shard, type ShardsState } from "./schema";

export const shardsRules: RuleModule<ShardsState> = {
  id: "shards",
  title: "芯片与阅读",
  commands: ["shard", "chip"],
  when: () => true,
  text: `- 芯片是有载体、有内容身份的真实物件。拿到或买到只登记物品，不自动阅读、安装、获得技能或触发任务。载体归属沿用 item/trade；目录芯片取得后使用实际 chip: 开头的独立载体 id，不再取得同一份。
- 已确立的内容先按实际设备与玩家要求展开，角色真正读到时写 chip read（carrier、device、parts）；原文由代码引用，不能改写。只看标签和简介不发 read。加密分段先按实际条件做 breach 取得 data，再用 chip unlock 引用对应保护网络，不能靠猜测或一次普通读取解开。
- 新资料先固定内容和来源，目录外真实载体用 item gain 的 definition.chipContentId 关联，chip define 登记一次，以后复用。普通邮件、日记、录音实际读到时才写 shard，固定 contentId + partId；后续分段不能覆盖原文，未解开、未读到的内容不进入知识。read 标记仅表示玩家界面是否点开，不代表角色未读。
- 复制用 chip copy，必须有实际来源、可用读写器和不同的空白载体 destination；副本引用同一内容，不复制钱、技能或其他资产。赠送与交付用 item lose + recipient；借出还需把真实返还约定写入已有承诺/人物记忆，交出原件不清除已读知识。给别人看或转述只按真实到达的信息更新其记忆，不把持有当阅读或让所有人同步得知。
- 功能辅助仅 chip use，本次能力受真实硬件、接口和固定功能限制，不变成永久技能、属性或装载槽。行为芯片只能经实际义体安装与本人运行状态启用，读说明不等于芯片接管；超梦媒体接正文体验，不把芯片 read 当作看完整部。
- 分段可有 media 附件（link/image/video/audio，url、label，可选 caption；video 可有 poster、captionsUrl），只引用已经确立可用的本地资源、用户提供链接或素材库地址，不编造网址。附件随原文定稿；正文可引用标签，不写 HTML。链接、标签和说明不证明远端内容或世界事实，界面加载也不代表角色已经联网、读取未解密部分或消耗游戏时间。
- 原文是文件的说法，可以有错、被剪辑或撒谎，不等于证实世界真相。调查通过正文追问与已有设备规则承接。重读保持固定内容；普通教程、音乐、私人便条与成年作品可平静结束，不强加阴谋、伤害、任务或关系奖励。文风和篇幅由写作预设负责。`,
};

function recallScore(shard: Shard, context?: SectionContext): number {
  if (!context) return 0;
  const text = context.input.text;
  const here = (context.world.slices.world as WorldClockState | undefined)?.location;
  const npcs = (context.world.slices.npc as NpcState | undefined)?.npcs ?? {};
  const direct = [shard.contentId, shard.title, shard.carrier, shard.from, ...shard.related]
    .filter((value): value is string => !!value && value.length > 1)
    .some((value) => text.includes(value));
  let score = direct ? 100 : 0;
  if (text.includes(`${shard.contentId}/${shard.partId}`)) score += 200;
  if (here && (shard.location === here || shard.related.includes(here))) score += 10;
  for (const person of Object.values(npcs)) {
    if (
      person.location === here &&
      (shard.related.includes(person.id) || shard.from === person.name)
    )
      score += 15;
  }
  const terms = text.match(/[\p{Script=Han}]{2,}|[a-zA-Z0-9-]{3,}/gu) ?? [];
  for (const term of terms) {
    if (shard.text.includes(term)) score += 6;
    if (term.length > 3)
      for (let i = 0; i + 2 <= term.length; i += 2)
        if (shard.text.includes(term.slice(i, i + 2))) score += 1;
  }
  return score;
}

function carrierLines(
  state: ShardsState,
  context: SectionContext,
  inventory: InventoryState,
): string[] {
  if (!context.data?.items) return [];
  const catalog = itemCatalog(context.data);
  const contents = chipContentCatalog(context.data, state);
  const carried = Object.keys(inventory.backpack).flatMap((id) => {
    const object = inventory.objects[id];
    if (object && object.holder !== "player") return [];
    const def = object?.definition ?? catalog.get(id);
    const content = def?.chipContentId ? contents.get(def.chipContentId) : undefined;
    return def && content ? [{ id, def, content }] : [];
  });
  const input = context.input.text;
  const reading =
    /读|播放|听|打开|查看内容|看一下|看看|重看|回放|翻阅/.test(input) &&
    !/不读|不看|先别|不要|只看标签|只看简介|能不能|可以.*[读看]|怎么读|多少钱|询价/.test(input);
  const lines: string[] = [];
  for (const { id, def, content } of carried) {
    lines.push(
      `载体 ${id} ${def.name} → 内容 ${content.id}《${content.title}》｜${content.purpose}｜${content.summary}${content.braindance ? `｜超梦作品 ${content.braindance}` : ""}${content.requirements.length ? `｜实际所需设备 ${content.requirements.join("、")}` : ""}${content.ability ? `｜固定功能 ${content.ability}` : ""}`,
    );
    const selected =
      input.includes(id) ||
      input.includes(content.id) ||
      input.includes(content.title) ||
      input.includes(def.name) ||
      carried.length === 1;
    for (const part of content.parts) {
      const readable = readableChipPart(state, content, part.id);
      lines.push(
        `  段落 ${part.id} ${part.label}：${readable ? "可读取" : `受保护，网络 ${part.protectionNetwork}`}`,
      );
      if (reading && selected && readable) {
        lines.push(`  【仅供本轮实际读取的固定材料；未执行读取前不算角色已知】${part.text}`);
        if (part.media?.length)
          lines.push(
            `  同段固定媒体附件（按原元数据呈现，不推断资源内未知内容）：${JSON.stringify(part.media)}`,
          );
      }
    }
  }
  return lines;
}

/** 最近资料与本轮关联资料共同召回；旧原文完整保存在存档和阅读页。 */
export function shardsSection(state: ShardsState, context?: SectionContext): string | undefined {
  const inventory = context
    ? InventoryStateSchema.safeParse(context.world.slices.inventory)
    : undefined;
  const lines = context && inventory?.success ? carrierLines(state, context, inventory.data) : [];
  const ranked = state.shards.map((shard, index) => ({
    shard,
    index,
    score: recallScore(shard, context),
  }));
  const selected = new Set(
    ranked
      .filter((entry) => entry.score >= 6)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 8)
      .map((entry) => entry.index),
  );
  for (let index = Math.max(0, state.shards.length - 3); index < state.shards.length; index++)
    selected.add(index);
  if (selected.size) lines.push("已实际读过的原文（资料的说法，未必属实；交出载体后仍可引用）：");
  for (const index of [...selected].sort((a, b) => a - b)) {
    const shard = state.shards[index];
    if (!shard) continue;
    lines.push(
      `- #${shard.id} ${shard.contentId}/${shard.partId}［${SHARD_KIND_LABELS[shard.kind]}］${shard.title}${shard.from ? `（${shard.from}）` : ""}｜${formatGameTime(shard.at)}${shard.carrier ? `｜来自载体 ${shard.carrier}` : ""}：${shard.text}`,
    );
    if (shard.media?.length)
      lines.push(`  已归档媒体元数据：${JSON.stringify(shard.media)}；不据链接补出未知内容。`);
  }
  if (state.shards.length > selected.size)
    lines.push(
      `另有 ${state.shards.length - selected.size} 段已读原文持续保存在阅读档案，按资料名、来源或有关人物地点引用可再次召回，不代表丢失。`,
    );
  return lines.length ? lines.join("\n") : undefined;
}
