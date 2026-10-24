import { defineSystem } from "../../kernel/system";
import type { EconomyState } from "../economy";
import { applyCyberware, applyDebt, cyberwareCatalog, install } from "./apply";
import { cyberwareRules } from "./prompt";
import {
  type CyberwareCommand,
  CyberwareCommandSchema,
  type CyberwareState,
  CyberwareStateSchema,
  type InstallCyberware,
  InstallCyberwareSchema,
  type RipperdocDebtCommand,
  RipperdocDebtCommandSchema,
} from "./schema";

/** 义体：按部位装卸，钱交给欧元系统扣，人性上限交给人性系统算 */
export const cyberware = defineSystem<
  CyberwareState,
  CyberwareCommand,
  InstallCyberware | RipperdocDebtCommand
>({
  id: "cyberware",
  dependsOn: ["economy", "humanity", "character", "world", "health"],
  state: CyberwareStateSchema,
  initial: () => ({ installed: [], settled: [], debts: [] }),
  commands: { cyberware: CyberwareCommandSchema },
  internal: {
    "cyberware.install": InstallCyberwareSchema,
    "cyberware.debt": RipperdocDebtCommandSchema,
  },
  apply(draft, command, ctx) {
    const catalog = cyberwareCatalog(ctx.data);
    if (command.type === "cyberware.debt") return applyDebt(draft, command, ctx.now);
    return command.type === "cyberware.install"
      ? install(draft, command.id, catalog, ctx.now)
      : applyCyberware(draft, command, catalog, ctx.now, ctx.read<EconomyState>("economy").eddies);
  },
  rules: [cyberwareRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
