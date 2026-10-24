import { defineSystem } from "../../kernel/system";
import type { EconomyState } from "../economy";
import { applyCyberware, cyberwareCatalog, install } from "./apply";
import { cyberwareRules } from "./prompt";
import {
  type CyberwareCommand,
  CyberwareCommandSchema,
  type CyberwareState,
  CyberwareStateSchema,
  type InstallCyberware,
  InstallCyberwareSchema,
} from "./schema";

/** 义体：按部位装卸，钱交给欧元系统扣，人性上限交给人性系统算 */
export const cyberware = defineSystem<CyberwareState, CyberwareCommand, InstallCyberware>({
  id: "cyberware",
  dependsOn: ["economy", "humanity", "character"],
  state: CyberwareStateSchema,
  initial: () => ({ installed: [], settled: [] }),
  commands: { cyberware: CyberwareCommandSchema },
  internal: { "cyberware.install": InstallCyberwareSchema },
  apply(draft, command, ctx) {
    const catalog = cyberwareCatalog(ctx.data);
    return command.type === "cyberware.install"
      ? install(draft, command.id, catalog, ctx.now)
      : applyCyberware(draft, command, catalog, ctx.now, ctx.read<EconomyState>("economy").eddies);
  },
  rules: [cyberwareRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
