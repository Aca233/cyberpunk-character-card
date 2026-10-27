import { defineSystem } from "../../kernel/system";
import {
  applyBreach,
  applyDive,
  applyHack,
  refill,
  regen,
  surfaceOnSceneEnd,
  syncDeck,
} from "./apply";
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
} from "./schema";
import { hackingView } from "./view";

/** 骇入：接入仓和 RAM 由装着的义体推出来；放快速破解扣 RAM，打完一段回一点，收尾回满 */
export const hacking = defineSystem<HackingState, HackCommand | BreachCommand | DiveCommand>({
  id: "hacking",
  dependsOn: ["cyberware", "humanity", "combat", "world"],
  state: HackingStateSchema,
  initial: () => ({
    deck: null,
    ram: 0,
    ramMax: 0,
    programs: [],
    breachedNetworks: [],
    dive: null,
  }),
  commands: { hack: HackCommandSchema, breach: BreachCommandSchema, dive: DiveCommandSchema },
  apply(draft, command, ctx) {
    if (command.type === "breach") return applyBreach(draft, command, ctx);
    if (command.type === "dive") return applyDive(draft, command, ctx);
    return applyHack(draft, command, ctx);
  },
  on: {
    "cyberware.changed": (draft, ctx) => {
      syncDeck(draft, ctx);
    },
    "combat.next": (draft) => regen(draft),
    "combat.end": (draft) => refill(draft),
    "scene.end": (draft) => {
      refill(draft);
      surfaceOnSceneEnd(draft);
    },
    rest: (draft) => refill(draft),
  },
  rules: [hackingRules],
  view: { key: "hacking", project: hackingView },
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
