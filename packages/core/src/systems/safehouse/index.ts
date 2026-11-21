import { z } from "zod";
import { defineSystem, type FeedItem, type ViewContext } from "../../kernel/system";
import { CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
import {
  InventoryStateSchema,
  itemCatalog,
  MOD_SLOT_LABELS,
  type ModSlot,
  withWorldObjects,
} from "../inventory";
import { NpcStateSchema } from "../npc";
import { TravelStateSchema, vehicleCatalog } from "../travel";
import {
  formatGameTime,
  locationCatalog,
  locationForTravel,
  WorldClockStateSchema,
} from "../world";
import { safehouseActions } from "./actions";
import { applyHome, applyItemPlace, homeAt, payHomeRent, seedHome, tickSafehouse } from "./apply";
import { safehouseRules } from "./prompt";
import {
  type HomeCommand,
  HomeCommandSchema,
  type ItemPlaceCommand,
  ItemPlaceCommandSchema,
  RENT_GRACE_DAYS,
  RENT_REMIND_BEFORE_DAYS,
  type SafehouseInternal,
  SafehouseInternalSchemas,
  type SafehouseState,
  SafehouseStateSchema,
} from "./schema";
import { safehouseStatus } from "./status";
import { safehouseView } from "./view";

const FeedReadSchema = z.object({ feedRead: z.array(z.string()).default([]) });

function safehouseFeed({ world }: ViewContext): readonly FeedItem[] {
  if (world.slices.safehouse === undefined) return [];
  const state = SafehouseStateSchema.parse(world.slices.safehouse);
  const read = new Set(FeedReadSchema.parse(world.slices.phone ?? {}).feedRead);
  const items: FeedItem[] = [];
  for (const h of state.homes) {
    if (h.tenure !== "rented" || h.rentPaidUntil === undefined) continue;
    const amount = h.rentAmount ?? 1200;
    const remindAt = h.rentPaidUntil - RENT_REMIND_BEFORE_DAYS * 1440;
    const lockAt = h.rentPaidUntil + RENT_GRACE_DAYS * 1440;
    if (world.time >= remindAt) {
      const id = `safehouse:rent:${h.id}:${h.rentPaidUntil}`;
      items.push({
        id,
        source: "safehouse",
        channel: "messages",
        from: `${h.name}物业`,
        text: `账单提醒：本期房租水电 ${amount} 欧元将于 ${formatGameTime(h.rentPaidUntil)} 到期，逾期 ${RENT_GRACE_DAYS} 天将自动锁门停水电。`,
        at: remindAt,
        time: formatGameTime(remindAt),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      });
    }
    if (h.locked && world.time >= lockAt) {
      const id = `safehouse:lock:${h.id}:${h.rentPaidUntil}`;
      items.push({
        id,
        source: "safehouse",
        channel: "messages",
        from: `${h.name}物业`,
        text: `门禁锁定通知：${h.name}已逾期未缴房租水电 ${amount} 欧元，电子锁已锁死并切断热水供应，缴清欠款后立即恢复通行。`,
        at: lockAt,
        time: formatGameTime(lockAt),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      });
    }
  }
  return items;
}

const HOME_CONTEXT = /家|屋|寓|窝|住处|睡觉|休息|躲|藏|回|换|穿|脱|留|拿|取|带/;
const CAR_CONTEXT = /车|摩托|后备箱|开|放|留|拿|取|弃|抛|扔/;

/** 安全屋与留置：开局按出身给一处住所，支持故事中获得/失去住处与关键物品留置记录 */
export const safehouse = defineSystem<
  SafehouseState,
  ItemPlaceCommand | HomeCommand,
  SafehouseInternal
>({
  id: "safehouse",
  dependsOn: ["world", "economy", "inventory", "travel", "cyberware", "npc", "health", "combat"],
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
      case "safehouse.payRent":
        return payHomeRent(draft, command, ctx);
    }
  },
  tick: tickSafehouse,
  feed: safehouseFeed,
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
        const items =
          safeData.items !== undefined
            ? itemCatalog(withWorldObjects(safeData, inv.objects))
            : new Map();
        const chrome = safeData.cyberware !== undefined ? cyberwareCatalog(safeData) : new Map();
        const cars = vehicleCatalog(safeData);
        const places = locationCatalog(safeData);
        const placeNameOf = (id: string) =>
          places.get(id)?.name ?? locationForTravel(safeData, id)?.name ?? id;
        const text = input.text;
        const askHome = HOME_CONTEXT.test(text);
        const askCar = CAR_CONTEXT.test(text);
        const lines: string[] = [];

        for (const h of state.homes) {
          if (homeAt(h, here, safeData)) continue;
          if (!askHome && !text.includes(h.id) && !text.includes(h.name)) continue;
          const locName = placeNameOf(h.location);
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
          return placeNameOf(loc ?? target);
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
          if (kind === "npc") {
            const npcName = npcs[target]?.name;
            if (text.includes(target) || (npcName ? text.includes(npcName) : false)) return true;
          }
          return false;
        };

        for (const p of inv.placed) {
          const obj = inv.objects[p.item];
          const name = items.get(p.item)?.name ?? obj?.definition.name ?? p.item;
          const baseId = obj?.weaponState?.baseId;
          if (
            !isRelevantPlace(p.kind, p.target, p.location, p.item, name, p.note) &&
            !(baseId && text.includes(baseId))
          )
            continue;
          const qty = p.count > 1 ? `×${p.count}` : "";
          const ws = obj?.weaponState;
          const wsParts: string[] = [];
          if (ws?.smartLink) wsParts.push("智能联锁");
          if (ws) {
            const fitted = Object.entries(ws.mods).flatMap(([slot, modId]) => {
              if (!modId) return [];
              const modName = items.get(modId)?.name ?? modId;
              return [`[${MOD_SLOT_LABELS[slot as ModSlot]}] ${modName}`];
            });
            if (fitted.length > 0) wsParts.push(`已装 ${fitted.join("、")}`);
          }
          const wsText = wsParts.length > 0 ? `（${wsParts.join("；")}）` : "";
          const noteText = p.note ? `；${p.note}` : "";
          lines.push(
            `- ${p.item} ${name}${qty}${wsText}：留在 ${whereLabel(p.kind, p.target, p.location)}（不在身上${noteText}）`,
          );
        }

        for (const part of Object.values(cyber.parts)) {
          if (part.condition === "scrapped") continue;
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
