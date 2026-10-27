import { defineSystem } from "../../kernel/system";
import type { CombatState } from "../combat";
import type { NpcState } from "../npc";
import { applyNemesis, applyNemesisMove } from "./apply";
import { nemesisRules, nemesisSection } from "./prompt";
import {
  NEMESIS_RISE_HOURS,
  type NemesisCommand,
  NemesisCommandSchema,
  type NemesisInternal,
  NemesisMoveCommandSchema,
  type NemesisState,
  NemesisStateSchema,
} from "./schema";

/** 宿敌：逃掉或被放走的有卡敌人升级而来，记着怎么输的、专克玩家的准备和屏幕外的动静 */
export const nemesis = defineSystem<NemesisState, NemesisCommand, NemesisInternal>({
  id: "nemesis",
  dependsOn: ["combat", "npc", "character"],
  state: NemesisStateSchema,
  initial: () => ({ nemeses: [], ended: [], recent: null }),
  commands: { nemesis: NemesisCommandSchema },
  internal: { "nemesis.move": NemesisMoveCommandSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "nemesis":
        return applyNemesis(draft, command, ctx);
      case "nemesis.move":
        return applyNemesisMove(draft, command, ctx.now);
    }
  },
  on: {
    /** 打完一仗：活着的有卡敌人在 24 小时内可以升级成宿敌 */
    "combat.end": (draft, ctx) => {
      const last = ctx.read<CombatState>("combat").last;
      const cards = ctx.read<NpcState>("npc").npcs;
      const foes = (last?.foes ?? []).filter((f) => cards[f.npc]?.alive).map((f) => f.npc);
      draft.recent = foes.length > 0 ? { foes, until: ctx.now + NEMESIS_RISE_HOURS * 60 } : null;
    },
  },
  tick(draft, span) {
    if (draft.recent && span.to > draft.recent.until) draft.recent = null;
  },
  rules: [nemesisRules],
  sections: [
    {
      order: 120,
      title: "宿敌",
      render: ({ world }) =>
        nemesisSection(NemesisStateSchema.parse(world.slices.nemesis ?? {}), world.time) ||
        undefined,
    },
  ],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
