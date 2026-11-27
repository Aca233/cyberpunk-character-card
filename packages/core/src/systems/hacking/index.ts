import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { hackingActions } from "./actions";
import {
  applyBreach,
  applyDeckLoad,
  applyDive,
  applyHack,
  applyNpcHack,
  clearLocalHackEffects,
  coolThermalOverTime,
  syncClaimedQuickhacks,
  syncDeck,
} from "./apply";
import { hackingRules } from "./prompt";
import {
  type BreachCommand,
  BreachCommandSchema,
  type DeckLoadCommand,
  DeckLoadCommandSchema,
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
 * 电子战骇入：以网络拓扑可达性、程序芯片槽位、个人黑冰破冰前置与接入仓热负荷取代蓝条回蓝。
 * 有卡的人放快速破解（npcHack）也在这里结算：读 npc 拿他的义体，读 cyberware 看玩家的自我 ICE。
 */
export const hacking = defineSystem<
  HackingState,
  HackCommand | BreachCommand | DiveCommand | NpcHackCommand | DeckLoadCommand
>({
  id: "hacking",
  dependsOn: ["cyberware", "combat", "world", "npc", "health", "tension", "inventory", "stealth"],
  state: HackingStateSchema,
  initial: () => ({
    deck: null,
    programs: [],
    ownedPrograms: [],
    starterSeeded: false,
    thermal: { heat: 0, updatedAt: 0, overloadCount: 0 },
    breachedTargets: [],
    activeEffects: [],
    traceAlert: null,
    breachedNetworks: [],
    dive: null,
    resolvedNpcHacks: [],
  }),
  commands: {
    hack: HackCommandSchema,
    breach: BreachCommandSchema,
    dive: DiveCommandSchema,
    npcHack: NpcHackCommandSchema,
    deckLoad: DeckLoadCommandSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "breach") return applyBreach(draft, command, ctx);
    if (command.type === "dive") return applyDive(draft, command, ctx);
    if (command.type === "npcHack") return applyNpcHack(draft, command, ctx);
    if (command.type === "deckLoad") return applyDeckLoad(draft, command, ctx);
    return applyHack(draft, command, ctx);
  },
  on: {
    "cyberware.changed": (draft, ctx) => {
      syncDeck(draft, ctx);
    },
    "inventory.quickhack": (draft, ctx) => {
      syncClaimedQuickhacks(draft, ctx);
    },
    "scene.end": (draft) => {
      draft.activeEffects = [];
      draft.breachedTargets = [];
      draft.traceAlert = null;
      draft.thermal.heat = Math.max(0, draft.thermal.heat - 2);
      draft.thermal.overloadCount = 0;
    },
    "world.arrived": (draft, ctx) => {
      const loc = ctx.read<WorldClockState>("world").location ?? null;
      clearLocalHackEffects(draft, loc);
    },
  },
  tick(draft, span, ctx) {
    coolThermalOverTime(draft, span, ctx);
  },
  rules: [hackingRules],
  actions: hackingActions,
  view: { key: "hacking", project: hackingView },
  status: hackingStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
