import { defineSystem } from "../../kernel/system";
import { CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
import { InventoryStateSchema, itemCatalog } from "../inventory";
import { NpcStateSchema } from "../npc";
import { TravelStateSchema, vehicleCatalog } from "../travel";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { safehouseActions } from "./actions";
import { applyHome, applyItemPlace, seedHome } from "./apply";
import { safehouseRules } from "./prompt";
import {
  type HomeCommand,
  HomeCommandSchema,
  type ItemPlaceCommand,
  ItemPlaceCommandSchema,
  type SafehouseInternal,
  SafehouseInternalSchemas,
  type SafehouseState,
  SafehouseStateSchema,
} from "./schema";
import { safehouseStatus } from "./status";
import { safehouseView } from "./view";

const HOME_CONTEXT = /家|屋|寓|窝|住处|睡觉|休息|躲|藏|回|换|穿|脱|留|拿|取|带/;
const CAR_CONTEXT = /车|摩托|后备箱|开|放|留|拿|取|弃|抛|扔/;

/** 安全屋与留置：开局按出身给一处住所，支持故事中获得/失去住处与关键物品留置记录 */
export const safehouse = defineSystem<
  SafehouseState,
  ItemPlaceCommand | HomeCommand,
  SafehouseInternal
>({
  id: "safehouse",
  dependsOn: ["world", "inventory", "travel", "cyberware", "npc"],
  state: SafehouseStateSchema,
  initial: () => ({ homes: [] }),
  commands: { itemPlace: ItemPlaceCommandSchema, home: HomeCommandSchema },
  internal: SafehouseInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "itemPlace":
        return applyItemPlace(draft, command, ctx);
      case "home":
        return applyHome(draft, command, ctx);
      case "safehouse.seed":
        return seedHome(draft, command, ctx.now);
    }
  },
  rules: [safehouseRules],
  sections: [
    {
      order: 73,
      title: "住处与留置物品",
      render: ({ world, data, input }) => {
        const safeData = data ?? {};
        const state = SafehouseStateSchema.parse(world.slices.safehouse ?? {});
        const here = WorldClockStateSchema.parse(world.slices.world).location;
        const inv = InventoryStateSchema.parse(world.slices.inventory);
        const travel = TravelStateSchema.parse(world.slices.travel);
        const cyber = CyberwareStateSchema.parse(world.slices.cyberware);
        const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
        const items = safeData.items !== undefined ? itemCatalog(safeData) : new Map();
        const chrome = safeData.cyberware !== undefined ? cyberwareCatalog(safeData) : new Map();
        const cars = vehicleCatalog(safeData);
        const places = locationCatalog(safeData);
        const text = input.text;
        const askHome = HOME_CONTEXT.test(text);
        const askCar = CAR_CONTEXT.test(text);
        const lines: string[] = [];

        for (const h of state.homes) {
          if (h.location === here) continue;
          if (!askHome && !text.includes(h.id) && !text.includes(h.name)) continue;
          const locName = places.get(h.location)?.name ?? h.location;
          lines.push(`- 住处 ${h.id}：${h.name}（位于 ${locName}，当前不在这里）`);
        }

        const whereLabel = (kind: string, target: string, loc: string | null): string => {
          if (kind === "home") {
            const h = state.homes.find((x) => x.id === target);
            return h ? `${h.name}（${h.id}）` : target;
          }
          if (kind === "vehicle") {
            const c = travel.vehicles.find((x) => x.id === target);
            const cname = c ? (cars.get(c.model)?.name ?? c.model) : target;
            return `${cname}（${target}${c?.abandoned ? "，已弃置" : ""}）`;
          }
          if (kind === "npc") {
            return npcs[target]?.name ?? target;
          }
          return places.get(loc ?? target)?.name ?? target;
        };

        const isRelevantPlace = (
          kind: string,
          target: string,
          loc: string | null,
          itemId: string,
          itemName: string,
          note?: string,
        ): boolean => {
          if (here !== null && loc === here) return true;
          if (text.includes(itemId) || text.includes(itemName) || (note && text.includes(note)))
            return true;
          if (kind === "home" && askHome) return true;
          if (kind === "vehicle") {
            const c = travel.vehicles.find((x) => x.id === target);
            if (c && here !== null && c.location === here) return true;
            if (askCar || text.includes(target)) return true;
          }
          if (kind === "npc" && (text.includes(target) || text.includes(npcs[target]?.name ?? "")))
            return true;
          return false;
        };

        for (const p of inv.placed) {
          const name = items.get(p.item)?.name ?? inv.objects[p.item]?.definition.name ?? p.item;
          if (!isRelevantPlace(p.kind, p.target, p.location, p.item, name, p.note)) continue;
          const qty = p.count > 1 ? `×${p.count}` : "";
          const noteText = p.note ? `；${p.note}` : "";
          lines.push(
            `- ${p.item} ${name}${qty}：留在 ${whereLabel(p.kind, p.target, p.location)}（不在身上${noteText}）`,
          );
        }

        for (const part of Object.values(cyber.parts)) {
          const colon = part.holder.indexOf(":");
          if (colon < 0) continue;
          const kind = part.holder.slice(0, colon);
          if (kind !== "home" && kind !== "vehicle" && kind !== "place") continue;
          const target = part.holder.slice(colon + 1);
          const name = chrome.get(part.model)?.name ?? part.model;
          if (!isRelevantPlace(kind, target, part.location, part.id, name)) continue;
          lines.push(
            `- ${part.id} ${name}（未安装义体）：留在 ${whereLabel(kind, target, part.location)}（不在身上）`,
          );
        }

        return lines.length > 0 ? lines.join("\n") : undefined;
      },
    },
  ],
  actions: safehouseActions,
  view: { key: "safehouse", project: safehouseView },
  status: safehouseStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
