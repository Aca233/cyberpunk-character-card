import { defineSystem } from "../../kernel/system";
import { applyFaction, applyFactionSeed, onNpcDied } from "./apply";
import { factionsEvents } from "./events";
import { factionRules } from "./prompt";
import {
  FactionCommandSchema,
  FactionSeedSchema,
  type FactionsCommand,
  type FactionsInternal,
  type FactionsState,
  FactionsStateSchema,
  FactionTurfSchema,
  FactionTurfToldSchema,
} from "./schema";
import { factionsStatus } from "./status";
import { factionsThreats, turfSection } from "./threats";
import { applyTurf, applyTurfTold } from "./turf";
import { factionsView } from "./view";

/**
 * 势力：态度、自由单归属成员身份（可选靠山与帮规污点）、大势力内部派系掌权与站队、以及主动地盘争夺；
 * 与 npc 系统实打实联动，关键人物死亡自动触发靠山失势与掌权派权力真空。
 */
export const factions = defineSystem<FactionsState, FactionsCommand, FactionsInternal>({
  id: "factions",
  dependsOn: ["npc"],
  state: FactionsStateSchema,
  initial: () => ({ stances: {}, turf: [], membership: null, wings: {}, contested: {} }),
  commands: {
    faction: FactionCommandSchema,
  },
  internal: {
    "faction.seed": FactionSeedSchema,
    "faction.turf": FactionTurfSchema,
    "faction.turfTold": FactionTurfToldSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "faction.seed") return applyFactionSeed(draft, command, ctx);
    if (command.type === "faction.turf") return applyTurf(draft, command, ctx);
    if (command.type === "faction.turfTold") return applyTurfTold(draft, command);
    return applyFaction(draft, command, ctx);
  },
  on: {
    "npc.died": onNpcDied,
  },
  rules: [factionRules],
  sections: [
    // 地盘伏击（用户 2026-10-31 选的「势力进机制」）：人在谁的地盘、对方什么态度，由代码给出街上的气氛
    {
      order: 111,
      title: "这里是谁的地盘",
      render: ({ world, data }) => turfSection({ world, data: data ?? {} }),
    },
  ],
  view: { key: "factions", project: factionsView },
  status: factionsStatus,
  threats: factionsThreats,
  events: factionsEvents,
});

export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./threats";
export * from "./turf";
export * from "./view";
