import { defineSystem } from "../../kernel/system";
import { locationCatalog, type WorldClockState } from "../world";
import { applyAlert } from "./apply";
import { stealthRules } from "./prompt";
import {
  type AlertCommand,
  AlertCommandSchema,
  type StealthState,
  StealthStateSchema,
} from "./schema";
import { stealthStatus } from "./status";
import { stealthView } from "./view";

/** 地点警戒事实持续保存；切场不解除警戒、不自动报警。 */
export const stealth = defineSystem<StealthState, AlertCommand>({
  id: "stealth",
  dependsOn: ["world"],
  state: StealthStateSchema,
  initial: () => ({ sites: {} }),
  commands: { alert: AlertCommandSchema },
  apply(draft, command, ctx) {
    const clock = ctx.read<WorldClockState>("world");
    const origin = ctx.facts.actionStartLocation;
    const fallback = typeof origin === "string" || origin === null ? origin : clock.location;
    const location = command.location ?? fallback;
    if (
      command.location !== undefined &&
      location !== clock.location &&
      location !== fallback &&
      !draft.sites[command.location] &&
      !locationCatalog(ctx.data).has(command.location)
    ) {
      return { ok: false, reason: "警戒变化必须指向已知地点，先登记新地点" };
    }
    return applyAlert(draft, command, location);
  },
  rules: [stealthRules],
  view: { key: "stealth", project: stealthView },
  status: stealthStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
