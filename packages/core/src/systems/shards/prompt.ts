import type { RuleModule, SectionContext } from "../../kernel/system";
import { CyberwareStateSchema } from "../cyberware";
import { HackingStateSchema } from "../hacking";
import { HealthStateSchema } from "../health";
import { type InventoryState, InventoryStateSchema, itemCatalog } from "../inventory";
import type { NpcState } from "../npc";
import { formatGameTime, type WorldClockState } from "../world";
import { activeChipHazard, chipContentCatalog, readableChipPart } from "./apply";
import {
  CHIP_CATEGORY_LABELS,
  CHIP_ENCRYPTION_LABELS,
  CHIP_HAZARD_LABELS,
  NEURAL_CHIP_SLOTS,
  SHARD_KIND_LABELS,
  type Shard,
  type ShardsState,
} from "./schema";

export const shardsRules: RuleModule<ShardsState> = {
  id: "shards",
  title: "神经芯片与阅读",
  commands: ["shard", "chip"],
  when: () => true,
  judge: `- 【当前状态】里的「神经芯片槽」是角色此刻插在颈后运行的技能/行为协议芯片，写着的能力是真实客观条件，与义体同等采信；拔出即失效，不提供任何属性数值或骰点加值。
- 未加密、无隐患的芯片可直接插个人颈后槽读取；但未知来源、带毒（malware）或带黑冰（black-ice）的芯片若未经隔离读写器（chip-reader-writer）沙盒查毒就直插读取，按具体威胁裁决反噬（神经症状、具体伤势或义体损坏）。
- 离线破译加密芯片依赖完好网络接入仓（可配合隔离读写器沙盒操作），按加密等级（standard / corp / military）与硬件条件定性裁决。`,
  narrate: `- 买到或捡到芯片只是拿在手里，不代表角色已经插入或读过内容。未解密的加密分段在破译前读不到正文；隐藏病毒或黑冰在查毒或触发反噬前角色不知情。
- 芯片和档案里的文字只是记录方的说法，可能撒谎、片面或被篡改，不自动成为客观真相；插在颈后神经芯片槽里的技能或行为协议按真实效果融入动作表现，拔出即失效。`,
  text: `- 芯片分五类：intel 情报资料、daemon 加密魔偶（含加密信用芯片/陷阱）、skill 技能协议、braindance 超梦卷轴、behavior 行为协议。买到或捡到只登记物品，不自动读取或插槽。
- 安全未加密芯片可直接通过颈后槽读（chip read，device 可省略）；未知来历芯片可先用隔离读写器沙盒查毒（chip inspect，device 填 chip-reader-writer）；有加密分段须有完好网络接入仓离线破译（chip decrypt，按需写 cleanHazard 清毒、extractEddies 提取信用芯片欧元）。
- skill / behavior 芯片用 chip equip 插入个人神经芯片槽（上限 ${NEURAL_CHIP_SLOTS} 槽，同款协议不可重复叠加）立即生效，拔出用 chip unequip；behavior 芯片须先装完好的 doll-behavior-chip，插拔时会自动联动切换其 protocol / off 状态，无需另发重复切态。
- 新确立载体内容用 chip define 登记，刻录副本用 chip copy（需读写器与空白芯片 blank-shard，信用芯片欧元不可复制）。现场零散邮件/日记/录音用 shard 快捷归档。
- 文件原文是记录方的说法，可能撒谎或被篡改，不自动成为世界真相；媒体附件（media）只引用已确立资源，不编造链接。`,
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

const GENERIC_CHIP_TOKENS = new Set([
  "芯片",
  "资料",
  "情报",
  "技能",
  "行为",
  "协议",
  "加密",
  "密钥",
  "信用",
  "卷轴",
  "超梦",
  "调查",
  "原片",
  "数据",
  "副本",
  "简报",
  "须知",
  "速查",
  "实时",
  "神经",
  "改装",
  "现场",
  "已提空",
]);

function chipKeywords(title: string, name: string): string[] {
  const raw = `${title} ${name}`;
  const chunks = raw
    .split(/[·：:（）()「」《》、\s/\\-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const tokens = new Set<string>();
  for (const chunk of chunks) {
    if (!GENERIC_CHIP_TOKENS.has(chunk)) tokens.add(chunk);
    // 针对 4 字以上连写中文标题提取常见 2–4 字区分片段（如“歌舞伎黑市风声”→“歌舞伎”“黑市”“风声”）
    if (/^[\p{Script=Han}]{4,}$/u.test(chunk)) {
      for (const size of [3, 2]) {
        for (let i = 0; i + size <= chunk.length; i += size) {
          const piece = chunk.slice(i, i + size);
          if (!GENERIC_CHIP_TOKENS.has(piece)) tokens.add(piece);
        }
      }
    }
  }
  return [...tokens];
}

function hasIntactDeckInWorld(context: SectionContext): boolean {
  const cyber = CyberwareStateSchema.safeParse(context.world.slices.cyberware ?? {});
  const health = HealthStateSchema.safeParse(context.world.slices.health ?? {});
  const hacking = HackingStateSchema.safeParse(context.world.slices.hacking ?? {});
  if (!cyber.success || !health.success || !hacking.success) return false;
  const deck = hacking.data.deck;
  return (
    !!deck &&
    cyber.data.installed.some((c) => c.id === deck) &&
    !health.data.brokenChrome.includes(deck)
  );
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
    /(?:读|插|看|听|打开|破译|解密|破解|解开|查毒|查验|扫描|重看|翻阅|翻看|提取|解析|解码|念|运行|刷入|启用)/.test(
      input,
    ) && !/不读|不看|先别|不要|只看标签|只看简介|多少钱|询价/.test(input);
  const decrypting = /(?:破译|解密|破解|解开|提取)/.test(input) && hasIntactDeckInWorld(context);
  const categoryCounts = new Map<string, number>();
  for (const item of carried) {
    categoryCounts.set(item.content.category, (categoryCounts.get(item.content.category) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const { id, def, content } of carried) {
    const slotted = state.slots.some((s) => s.carrier === id);
    const inspected = state.inspected.includes(id);
    const hazard = activeChipHazard(state, id, content);
    const eddiesLeft = content.eddies > 0 && !state.drained.includes(id) ? content.eddies : 0;
    const tags = [
      CHIP_CATEGORY_LABELS[content.category],
      ...(slotted ? ["已插槽运行中"] : []),
      ...(content.encryption !== "none" ? [CHIP_ENCRYPTION_LABELS[content.encryption]] : []),
      ...(hazard !== "none"
        ? [
            inspected
              ? `已检出${CHIP_HAZARD_LABELS[hazard]}`
              : `隐藏隐患:${CHIP_HAZARD_LABELS[hazard]}(角色未查毒未知)`,
          ]
        : []),
      ...(eddiesLeft > 0 ? [`含 ${eddiesLeft} 欧元凭证`] : []),
      ...(content.braindance ? [`超梦作品 ${content.braindance}`] : []),
      ...(content.protocol ? [`协议 ${content.protocol}`] : []),
    ];
    lines.push(
      `载体 ${id} ${def.name} → 《${content.title}》（${content.id}）｜${tags.join("｜")}｜${content.summary}${content.ability ? `｜槽位能力：${content.ability}` : ""}`,
    );
    const categoryLabel = CHIP_CATEGORY_LABELS[content.category];
    const selected =
      input.includes(id) ||
      input.includes(content.id) ||
      input.includes(content.title) ||
      input.includes(def.name) ||
      carried.length === 1 ||
      ((categoryCounts.get(content.category) ?? 0) === 1 &&
        (input.includes(categoryLabel) ||
          (content.category === "daemon" && /(?:加密|信用|黑冰|病毒)/.test(input)) ||
          (content.category === "intel" && /(?:情报|资料)/.test(input)) ||
          (content.category === "skill" && /技能/.test(input)) ||
          (content.category === "behavior" && /行为/.test(input)))) ||
      chipKeywords(content.title, def.name).some((kw) => input.includes(kw));
    for (const part of content.parts) {
      const readable = readableChipPart(state, id, content, part.id);
      lines.push(
        `  段落 ${part.id} ${part.label}：${readable ? "可读取" : `已加密（${CHIP_ENCRYPTION_LABELS[content.encryption]}，${context.stage === "narrate" ? "未破译前不可读" : "需先 decrypt"}）`}`,
      );
      if (context.stage === "judge") continue;
      if (reading && selected && readable) {
        lines.push(`  【本轮可读取固定材料】${part.text}`);
        if (part.media?.length && context.stage === "extract")
          lines.push(`  同段媒体元数据：${JSON.stringify(part.media)}`);
      } else if (context.stage === "narrate" && decrypting && selected && !readable) {
        lines.push(
          `  【仅当本轮裁决允许破译成功时可见的密文；若裁决为 blocked 或本轮未破译，严禁在正文泄露】${part.text}`,
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
  if (selected.size) lines.push("已读档案（资料说法未必属实；交出载体后仍记得）：");
  for (const index of [...selected].sort((a, b) => a - b)) {
    const shard = state.shards[index];
    if (!shard) continue;
    lines.push(
      `- #${shard.id} ${shard.contentId}/${shard.partId}［${CHIP_CATEGORY_LABELS[shard.category]}·${SHARD_KIND_LABELS[shard.kind]}］${shard.title}${shard.from ? `（${shard.from}）` : ""}｜${formatGameTime(shard.at)}${shard.carrier ? `｜载体 ${shard.carrier}` : ""}：${shard.text}`,
    );
    if (shard.media?.length && context?.stage === "extract")
      lines.push(`  已归档媒体元数据：${JSON.stringify(shard.media)}`);
  }
  if (state.shards.length > selected.size)
    lines.push(
      `另有 ${state.shards.length - selected.size} 段已读档案保存在芯片库，可按标题、来源或关联人地召回。`,
    );
  return lines.length ? lines.join("\n") : undefined;
}
