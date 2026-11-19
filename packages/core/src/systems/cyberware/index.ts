import { defineSystem } from "../../kernel/system";
import type { HealthState } from "../health";
import { cyberwareActions } from "./actions";
import { applyBoost, applyCyberware, applyDebt, cyberwareCatalog, install } from "./apply";
import { applyBehaviorChip, behaviorChipLines } from "./behavior";
import { cyberwareEvents } from "./events";
import { cyberwareInteractions } from "./interactions";
import { cyberwareRules } from "./prompt";
import { ripperdocDebtsView, ripperdocView } from "./ripperdoc";
import { sandevistanView } from "./sandevistan";
import {
  type BehaviorChipCommand,
  BehaviorChipCommandSchema,
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
import { cyberwareStatus } from "./status";
import { visitClinics, withClinicOperations } from "./stock";
import { cyberwarePartsView, cyberwareView } from "./view";
import { advanceSupplies, applyWorkshop, tickWorkshop } from "./workshop";
import {
  ClinicCommandSchema,
  type CyberwarePlaceCommand,
  CyberwarePlaceSchema,
  type CyberwareRelocateVehicleCommand,
  CyberwareRelocateVehicleSchema,
  PartCommandSchema,
  ServiceCommandSchema,
  SupplyCommandSchema,
  type WorkshopCommand,
} from "./workshop-schema";

/** 义体：共同交易入口核对诊所和授权，原子更新义体、款项与债务。 */
export const cyberware = defineSystem<
  CyberwareState,
  CyberwareCommand | WorkshopCommand | BehaviorChipCommand,
  | InstallCyberware
  | RipperdocDebtCommand
  | BoostCommand
  | CyberwarePlaceCommand
  | CyberwareRelocateVehicleCommand
>({
  id: "cyberware",
  dependsOn: [
    "economy",
    "humanity",
    "character",
    "world",
    "health",
    "npc",
    "commerce",
    "logistics",
    "city",
  ],
  state: CyberwareStateSchema,
  data: withClinicOperations,
  initial: () => ({
    installed: [],
    settled: [],
    debts: [],
    clinics: {},
    parts: {},
    services: {},
    supplies: {},
    boost: null,
  }),
  commands: {
    cyberware: CyberwareCommandSchema,
    "cyberware.clinic": ClinicCommandSchema,
    "cyberware.part": PartCommandSchema,
    "cyberware.service": ServiceCommandSchema,
    "cyberware.supply": SupplyCommandSchema,
    "cyberware.behavior": BehaviorChipCommandSchema,
  },
  internal: {
    "cyberware.install": InstallCyberwareSchema,
    "cyberware.debt": RipperdocDebtCommandSchema,
    "cyberware.boost": BoostCommandSchema,
    "cyberware.place": CyberwarePlaceSchema,
    "cyberware.relocateVehicle": CyberwareRelocateVehicleSchema,
  },
  apply(draft, command, _ctx) {
    if (command.type === "cyberware.relocateVehicle") {
      const tag = `vehicle:${command.vehicle}`;
      for (const part of Object.values(draft.parts)) {
        if (part.holder === tag) part.location = command.location;
      }
      return { ok: true };
    }
    if (command.type === "cyberware.place") {
      const part = draft.parts[command.part];
      if (!part || part.condition === "scrapped")
        return { ok: false, reason: "义体实物不存在或已报废" };
      if (command.action === "leave") {
        if (part.holder !== "player") return { ok: false, reason: "玩家没有在现场携带这件义体" };
        part.holder = command.holder;
        part.location = command.location;
      } else {
        if (part.holder !== command.holder) return { ok: false, reason: "这件义体不在指定位置" };
        part.holder = "player";
        part.location = null;
      }
      return { ok: true };
    }
    const ctx = _ctx;
    const catalog = cyberwareCatalog(ctx.data);
    if (command.type === "cyberware.behavior") {
      const states = draft.behaviorChips ?? {};
      const result = applyBehaviorChip(
        states,
        draft.installed.map((entry) => entry.id),
        command,
        catalog,
        ctx.now,
        ctx.facts,
        ctx.read<HealthState>("health").brokenChrome,
      );
      if (result.ok) draft.behaviorChips = states;
      return result;
    }
    if (command.type === "cyberware.debt") return applyDebt(draft, command, ctx);
    if (command.type === "cyberware.boost") {
      const broken = ctx.read<HealthState>("health").brokenChrome;
      return applyBoost(draft, command.id, catalog, ctx.now, broken);
    }
    return command.type === "cyberware.install"
      ? install(draft, command.id, catalog, ctx.now)
      : command.type === "cyberware"
        ? applyCyberware(draft, command, ctx)
        : applyWorkshop(draft, command, ctx);
  },
  rules: [cyberwareRules],
  actions: cyberwareActions,
  view: { key: "cyberware", project: cyberwareView },
  views: [
    { key: "cyberwareParts", project: cyberwarePartsView },
    { key: "ripperdoc", project: ripperdocView },
    { key: "ripperdocDebts", project: ripperdocDebtsView },
    { key: "sandevistan", project: sandevistanView },
  ],
  status: cyberwareStatus,
  sections: [
    {
      order: 79,
      title: "义体实物与服务",
      render: ({ world, data, input }) => {
        const state = CyberwareStateSchema.parse(world.slices.cyberware);
        const catalog = cyberwareCatalog(data ?? {});
        const parts = Object.values(state.parts).filter((p) => p.holder === "player");
        const services = Object.values(state.services).filter(
          (s) => !["completed", "cancelled"].includes(s.status),
        );
        const lines = [
          ...behaviorChipLines(
            state.installed.map((entry) => entry.id),
            state.behaviorChips,
            catalog,
            input.text,
          ),
          ...parts.map(
            (p) =>
              `未安装义体 ${p.id}：${catalog.get(p.model)?.name ?? p.model}（型号 ${p.model}），货况 ${p.condition}，来源 ${p.source}；不是已安装能力`,
          ),
          ...services.map(
            (s) =>
              `服务订单 ${s.id}：${s.status}，${s.providerName}，${s.terms.action} ${s.terms.id}；起止 ${s.startedAt ?? s.scheduledAt}—${s.endsAt}；已付 ${s.status === "booked" ? 0 : s.cash}；实物 ${s.part ?? "原已安装部件"}；旧件 ${s.oldPart ?? "无"}`,
          ),
        ];
        return lines.length ? lines.join("\n") : undefined;
      },
    },
  ],
  interactions: cyberwareInteractions,
  events: cyberwareEvents,
  on: {
    "world.arrived": visitClinics,
    "logistics.changed": (draft, ctx) => advanceSupplies(draft, ctx.now, ctx),
  },
  tick(draft, span, ctx) {
    tickWorkshop(draft, span.to, ctx);
  },
});

export * from "./actions";
export * from "./apply";
export * from "./behavior";
export * from "./events";
export * from "./interactions";
export * from "./prompt";
export * from "./quote";
export * from "./ripperdoc";
export * from "./sandevistan";
export * from "./schema";
export * from "./service";
export * from "./status";
export * from "./stock";
export * from "./view";
export * from "./workshop";
export * from "./workshop-schema";
