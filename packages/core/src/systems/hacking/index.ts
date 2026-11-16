import { defineSystem } from "../../kernel/system";
import { applyBreach, applyDive, applyHack, applyNpcHack, syncDeck } from "./apply";
import { hackingRules } from "./prompt";
import {
  type BreachCommand,
  BreachCommandSchema,
  type DiveCommand,
  DiveCommandSchema,
  type HackCommand,
  HackCommandSchema,
  type HackingState,
  HackingStateSchema,
  type NpcHackCommand,
  NpcHackCommandSchema,
} from "./schema";
import { hackingStatus } from "./status";
import { hackingView } from "./view";

/**
 * 骇入：接入仓容量与程序来源由装着的义体推出来；一次程序的容量核验不转化为场景次数。
 * 有卡的人放快速破解（npcHack）也在这里结算：读 npc 拿他的义体，读 cyberware 看玩家的自我 ICE
 */
export const hacking = defineSystem<
  HackingState,
  HackCommand | BreachCommand | DiveCommand | NpcHackCommand
>({
  id: "hacking",
  dependsOn: ["cyberware", "combat", "world", "npc", "health"],
  state: HackingStateSchema,
  initial: () => ({
    deck: null,
    ramMax: 0,
    programs: [],
    breachedNetworks: [],
    dive: null,
    resolvedNpcHacks: [],
  }),
  commands: {
    hack: HackCommandSchema,
    breach: BreachCommandSchema,
    dive: DiveCommandSchema,
    npcHack: NpcHackCommandSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "breach") return applyBreach(draft, command, ctx);
    if (command.type === "dive") return applyDive(draft, command, ctx);
    if (command.type === "npcHack") return applyNpcHack(draft, command, ctx);
    return applyHack(draft, command, ctx);
  },
  on: {
    "cyberware.changed": (draft, ctx) => {
      syncDeck(draft, ctx);
    },
  },
  rules: [hackingRules],
  view: { key: "hacking", project: hackingView },
  status: hackingStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
