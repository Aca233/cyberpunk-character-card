import type { ViewContext } from "../../kernel/system";
import { reputationOverview } from "./apply";
import { CharacterStateSchema, DEED_REACH_LABELS } from "./schema";

/** 玩家看到的角色：外界知道的事迹与风声、主板模块、习惯、过往和闪回 */
export function characterView({ world }: ViewContext) {
  const character = CharacterStateSchema.parse(world.slices.character);
  const rep = reputationOverview(character.deeds);
  return {
    name: character.name,
    brief: character.brief,
    /** 角色卡提供的称谓与外貌；没有提供时不从简介补猜。 */
    visual: character.visual ? { ...character.visual } : null,
    /** 由已知事迹推导的界面极简概括，不再使用声望等级数字 */
    reputationLabel: rep.label,
    reputationSummary: rep.world,
    /** 外界知道你干过的事（最新在后） */
    deeds: character.deeds.map((d) => ({
      id: d.id,
      summary: d.summary,
      knownBy: d.knownBy,
      reach: d.reach,
      reachLabel: DEED_REACH_LABELS[d.reach],
      district: d.district ?? null,
      at: d.at,
      updatedAt: d.updatedAt,
    })),
    /** 主板上的模块；没用主板的角色是空的 */
    traits: character.traits,
    /** 习惯栏，和叙事模型提议、等玩家确认的习惯 */
    habits: character.habits,
    habitOffers: character.habitOffers,
    /** 角色的过往，闪回用过没有 */
    pasts: character.traits
      .filter((t) => t.slot === "past")
      .map((t) => ({ label: t.label, used: false })),
    /** 正在进行的闪回：第几轮（从 1 起），共几轮 */
    flashback: character.flashback && {
      past: character.flashback.past,
      turn: character.flashback.turns + 1,
      turns: null,
    },
    /** 闪回里确认的事 */
    pastFacts: character.pastFacts,
    /** 建档时的角色立绘 ID */
    portrait: character.portrait ?? null,
  };
}
