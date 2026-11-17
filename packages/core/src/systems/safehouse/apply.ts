import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { type InventoryState, itemCatalog } from "../inventory";
import { type TravelState, vehicleCatalog } from "../travel";
import type { WorldClockState } from "../world";
import {
  ApartmentCatalogSchema,
  type ApartmentDef,
  type SafehouseInternal,
  type SafehouseState,
  type StashCommand,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export type Container =
  | { readonly kind: "home"; readonly id: string; readonly name: string }
  | {
      readonly kind: "trunk";
      readonly id: string;
      readonly name: string;
      readonly cap: number;
      readonly location: string | null;
      readonly wrecked: boolean;
      readonly items: Readonly<Record<string, number>>;
    };

/** 车辆本身保存后备箱内容；报废车仍允许在现场取出物品。 */
export function trunks(
  travel: Pick<TravelState, "vehicles">,
  data: Readonly<Record<string, unknown>>,
): Container[] {
  const models = vehicleCatalog(data);
  return (travel.vehicles ?? []).map((v) => {
    const def = models.get(v.model);
    return {
      kind: "trunk",
      id: v.id,
      name: `${def?.name ?? v.model}的后备箱`,
      cap: def?.trunk ?? 0,
      location: v.location,
      wrecked: v.condition === "wrecked",
      items: v.cargo,
    };
  });
}

function containerOf(
  state: SafehouseState,
  where: string | undefined,
  ctx: SystemContext,
): Container | string {
  const location = ctx.read<WorldClockState>("world").location;
  if (location === null) return "当前位置未知，无法访问存放箱或后备箱";
  if (where === undefined) {
    const home = state.homes.find((h) => h.location === location);
    if (home) return { kind: "home", id: home.id, name: `${home.name}的存放箱` };
    return "不在安全屋：要用后备箱写 where（车的 id）";
  }
  const home = state.homes.find((h) => h.id === where);
  if (home) {
    if (home.location !== location) return `不在${home.name}，先回去`;
    return { kind: "home", id: home.id, name: `${home.name}的存放箱` };
  }
  const trunk = trunks(ctx.read<TravelState>("travel"), ctx.data).find((t) => t.id === where);
  if (trunk && trunk.kind === "trunk") {
    if (trunk.location !== location) return "车辆不在当前位置，无法访问后备箱";
    return trunk;
  }
  const known = [
    ...state.homes.map((h) => h.id),
    ...trunks(ctx.read<TravelState>("travel"), ctx.data).map((t) => t.id),
  ];
  return `没有叫 ${where} 的安全屋或车；能放的：${known.join("、") || "没有"}`;
}

export function applyStash(
  draft: Draft<SafehouseState>,
  command: StashCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const box = containerOf(draft, command.where, ctx);
  if (typeof box === "string") return fail(box);
  const physical = ctx.read<CyberwareState>("cyberware").parts[command.item];
  const name =
    (physical
      ? cyberwareCatalog(ctx.data).get(physical.model)?.name
      : itemCatalog(ctx.data).get(command.item)?.name) ?? command.item;
  const location = ctx.read<WorldClockState>("world").location;
  const move = (action: "store" | "take") =>
    physical
      ? { type: "cyberware.stash", part: command.item, action, where: box.id, location }
      : { type: "inventory.stash", action: action === "store" ? "out" : "in", id: command.item };
  const items = draft.stash[box.id] ?? {};
  const stored = box.kind === "trunk" ? box.items : items;
  const cargo = {
    type: "vehicle.stash",
    action: command.action,
    vehicle: box.id,
    item: command.item,
  };
  if (command.action === "store") {
    if (box.kind === "trunk" && box.wrecked) return fail("车辆已经报废，只能取出后备箱物品");
    const inv = ctx.read<InventoryState>("inventory");
    const carried = physical
      ? Number(
          physical.holder === "player" &&
            physical.location === null &&
            physical.condition !== "scrapped",
        )
      : (inv.backpack[command.item] ?? 0) + inv.weapons.filter((w) => w === command.item).length;
    if (carried < 1) return fail(`背包里没有${name}；穿着的衣服或快捷栏里的药/雷需要先脱下`);
    if (
      box.kind === "trunk" &&
      stored[command.item] === undefined &&
      Object.keys(stored).length >= box.cap
    )
      return fail(`${box.name}满了（${box.cap} 格）`);
    if (box.kind === "home") {
      items[command.item] = (items[command.item] ?? 0) + 1;
      draft.stash[box.id] = items;
    }
    return {
      ok: true,
      notes: [`把${name}放进${box.name}（${command.reason}）`],
      emit: [...(box.kind === "trunk" ? [cargo] : []), move("store")],
    };
  }
  const count = stored[command.item] ?? 0;
  if (count < 1) return fail(`${box.name}里没有${name}`);
  if (box.kind === "home") {
    if (count === 1) Reflect.deleteProperty(items, command.item);
    else items[command.item] = count - 1;
  }
  return {
    ok: true,
    notes: [`从${box.name}拿出${name}（${command.reason}）`],
    emit: [...(box.kind === "trunk" ? [cargo] : []), move("take")],
  };
}

export function seedHome(
  draft: Draft<SafehouseState>,
  command: SafehouseInternal,
  now: number,
): ApplyOutcome {
  if (draft.homes.some((h) => h.id === command.id)) return { ok: true, notes: [] };
  draft.homes.push({ id: command.id, name: command.name, location: command.location, since: now });
  return { ok: true, notes: [`住处：${command.name}`] };
}

/** 能买下的公寓表；数据表里没有时为空 */
export function apartmentList(data: Readonly<Record<string, unknown>>): readonly ApartmentDef[] {
  const parsed = ApartmentCatalogSchema.safeParse(data.apartments);
  return parsed.success ? parsed.data : [];
}

/** 这处公寓为什么买不了；能买时为 undefined。同一个地点只算一处住所 */
export function apartmentLocked(
  homes: readonly { readonly id: string; readonly name: string; readonly location: string }[],
  def: ApartmentDef,
): string | undefined {
  if (homes.some((h) => h.id === def.id)) return `${def.name}已经是你的了`;
  const there = homes.find((h) => h.location === def.location);
  if (there) return `这里已经有${there.name}，不用再买一处`;
  return undefined;
}
