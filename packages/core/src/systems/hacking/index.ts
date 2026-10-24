import { defineSystem } from "../../kernel/system";
import { applyHack, refill, regen, syncDeck } from "./apply";
import { hackingRules } from "./prompt";
import {
  type HackCommand,
  HackCommandSchema,
  type HackingState,
  HackingStateSchema,
} from "./schema";

/** 骇入：接入仓和 RAM 由装着的义体推出来；放快速破解扣 RAM，打完一段回一点，收尾回满 */
export const hacking = defineSystem<HackingState, HackCommand>({
  id: "hacking",
  dependsOn: ["cyberware", "humanity", "combat"],
  state: HackingStateSchema,
  initial: () => ({ deck: null, ram: 0, ramMax: 0, programs: [], breachedNetworks: [] }),
  commands: { hack: HackCommandSchema },
  apply: (draft, command, ctx) => applyHack(draft, command, ctx),
  on: {
    "cyberware.changed": (draft, ctx) => {
      syncDeck(draft, ctx);
    },
    "combat.next": (draft) => regen(draft),
    "combat.end": (draft) => refill(draft),
    "scene.end": (draft) => refill(draft),
    rest: (draft) => refill(draft),
  },
  rules: [hackingRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
