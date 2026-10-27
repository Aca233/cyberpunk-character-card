import { defineSystem } from "../../kernel/system";
import type { EconomyState } from "../economy";
import type { HealthState } from "../health";
import { cyberwareActions } from "./actions";
import { applyBoost, applyCyberware, applyDebt, cyberwareCatalog, install } from "./apply";
import { cyberwareEvents } from "./events";
import { cyberwareInteractions } from "./interactions";
import { cyberwareRules } from "./prompt";
import { ripperdocDebtsView, ripperdocView } from "./ripperdoc";
import { sandevistanView } from "./sandevistan";
import {
  type BoostCommand,
  BoostCommandSchema,
  type CyberwareCommand,
  CyberwareCommandSchema,
  type CyberwareState,
  CyberwareStateSchema,
  type InstallCyberware,
  InstallCyberwareSchema,
  type RipperdocDebtCommand,
  RipperdocDebtCommandSchema,
} from "./schema";
import { cyberwareView } from "./view";

/** 义体：按部位装卸，钱交给欧元系统扣，人性上限交给人性系统算 */
export const cyberware = defineSystem<
  CyberwareState,
  CyberwareCommand,
  InstallCyberware | RipperdocDebtCommand | BoostCommand
>({
  id: "cyberware",
  dependsOn: ["economy", "humanity", "character", "world", "health"],
  state: CyberwareStateSchema,
  initial: () => ({ installed: [], settled: [], debts: [], boost: null }),
  commands: { cyberware: CyberwareCommandSchema },
  internal: {
    "cyberware.install": InstallCyberwareSchema,
    "cyberware.debt": RipperdocDebtCommandSchema,
    "cyberware.boost": BoostCommandSchema,
  },
  apply(draft, command, ctx) {
    const catalog = cyberwareCatalog(ctx.data);
    if (command.type === "cyberware.debt") return applyDebt(draft, command, ctx.now);
    if (command.type === "cyberware.boost") {
      const broken = ctx.read<HealthState>("health").brokenChrome;
      return applyBoost(draft, command.id, catalog, ctx.now, broken);
    }
    return command.type === "cyberware.install"
      ? install(draft, command.id, catalog, ctx.now)
      : applyCyberware(draft, command, catalog, ctx.now, ctx.read<EconomyState>("economy").eddies);
  },
  rules: [cyberwareRules],
  actions: cyberwareActions,
  view: { key: "cyberware", project: cyberwareView },
  views: [
    { key: "ripperdoc", project: ripperdocView },
    { key: "ripperdocDebts", project: ripperdocDebtsView },
    { key: "sandevistan", project: sandevistanView },
  ],
  interactions: cyberwareInteractions,
  events: cyberwareEvents,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./interactions";
export * from "./prompt";
export * from "./ripperdoc";
export * from "./sandevistan";
export * from "./schema";
export * from "./view";
