import { defineSystem } from "../../kernel/system";
import type { CombatState } from "../combat";
import type { NpcState } from "../npc";
import { applyNemesis } from "./apply";
import { nemesisEvents } from "./events";
import { nemesisRules, nemesisSection } from "./prompt";
import {
  NEMESIS_RISE_HOURS,
  type NemesisCommand,
  NemesisCommandSchema,
  type NemesisState,
  NemesisStateSchema,
} from "./schema";
import { nemesisThreats } from "./threats";
import { nemesesEndedView, nemesisCardsView } from "./view";

/** 宿敌：记身份、败因、准备和了结；场外动作归统一单子（用户 2026-11-01 定的"全改"第 4 步） */
export const nemesis = defineSystem<NemesisState, NemesisCommand>({
  id: "nemesis",
  dependsOn: ["combat", "npc"],
  state: NemesisStateSchema,
  initial: () => ({ nemeses: [], ended: [], recent: null }),
  commands: { nemesis: NemesisCommandSchema },
  apply: applyNemesis,
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
  view: { key: "nemesesEnded", project: nemesesEndedView },
  views: [{ key: "nemesisCards", project: nemesisCardsView }],
  threats: nemesisThreats,
  events: nemesisEvents,
});

export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./threats";
export * from "./view";
