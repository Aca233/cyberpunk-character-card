import type { ViewContext } from "../../kernel/system";
import { credTier } from "./apply";
import { CharacterStateSchema } from "./schema";

/** 玩家看到的角色：街头声望、主板模块、习惯、过往和闪回 */
export function characterView({ world }: ViewContext) {
  const character = CharacterStateSchema.parse(world.slices.character);
  return {
    name: character.name,
    brief: character.brief,
    /** 角色卡提供的称谓与外貌；没有提供时不从简介补猜。 */
    visual: character.visual ? { ...character.visual } : null,
    streetCred: character.streetCred,
    credTier: credTier(character.streetCred).label,
    credWorld: credTier(character.streetCred).world,
    /** 攒着半级声望，再得半级就升级 */
    credHalf: character.credHalf,
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
