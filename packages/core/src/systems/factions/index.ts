import { defineSystem } from "../../kernel/system";
import { applyFaction } from "./apply";
import { factionsEvents } from "./events";
import { factionRules } from "./prompt";
import {
  FactionCommandSchema,
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
 * 势力：每个帮派、公司对玩家的态度标签和一句理由，叙事模型按发生的事调整；
 * 势力的打算并进了【城里在发酵的事】（用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账），
 * 这里只记那边核对过的地盘变化
 */
export const factions = defineSystem<FactionsState, FactionsCommand, FactionsInternal>({
  id: "factions",
  dependsOn: [],
  state: FactionsStateSchema,
  initial: () => ({ stances: {}, turf: [] }),
  commands: {
    faction: FactionCommandSchema,
  },
  internal: {
    "faction.turf": FactionTurfSchema,
    "faction.turfTold": FactionTurfToldSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "faction.turf") return applyTurf(draft, command, ctx);
    if (command.type === "faction.turfTold") return applyTurfTold(draft, command);
    return applyFaction(draft, command, ctx);
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
