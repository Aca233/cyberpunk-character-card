import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { type InventoryState, itemCatalog } from "../inventory";
import { type TravelState, vehicleCatalog } from "../travel";
import type { WorldClockState } from "../world";
import {
  type SafehouseInternal,
  type SafehouseState,
  type StashCommand,
  TROPHIES_MAX,
  type TrophyCommand,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export type Container =
  | { readonly kind: "home"; readonly id: string; readonly name: string }
  | { readonly kind: "trunk"; readonly id: string; readonly name: string; readonly cap: number };

/** 车的后备箱：名下、没报废的车 */
export function trunks(
  travel: Pick<TravelState, "vehicles">,
  data: Readonly<Record<string, unknown>>,
): Container[] {
  const models = vehicleCatalog(data);
  return (travel.vehicles ?? [])
    .filter((v) => v.condition !== "wrecked")
    .map((v) => {
      const def = models.get(v.model);
      return {
        kind: "trunk",
        id: v.id,
        name: `${def?.name ?? v.model}的后备箱`,
        cap: def?.trunk ?? 0,
      };
    });
}

function containerOf(
  state: SafehouseState,
  where: string | undefined,
  ctx: SystemContext,
): Container | string {
  const location = ctx.read<WorldClockState>("world").location;
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
  if (trunk) return trunk;
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
  const name = itemCatalog(ctx.data).get(command.item)?.name ?? command.item;
  const items = draft.stash[box.id] ?? {};
  if (command.action === "store") {
    const backpack = ctx.read<InventoryState>("inventory").backpack;
    if ((backpack[command.item] ?? 0) < 1) return fail(`背包里没有${name}；装备着的要先卸下`);
    if (
      box.kind === "trunk" &&
      items[command.item] === undefined &&
      Object.keys(items).length >= box.cap
    )
      return fail(`${box.name}满了（${box.cap} 格）`);
    items[command.item] = (items[command.item] ?? 0) + 1;
    draft.stash[box.id] = items;
    return {
      ok: true,
      notes: [`把${name}放进${box.name}（${command.reason}）`],
      emit: [{ type: "inventory.stash", action: "out", id: command.item }],
    };
  }
  const count = items[command.item] ?? 0;
  if (count < 1) return fail(`${box.name}里没有${name}`);
  if (count === 1) Reflect.deleteProperty(items, command.item);
  else items[command.item] = count - 1;
  return {
    ok: true,
    notes: [`从${box.name}拿出${name}（${command.reason}）`],
    emit: [{ type: "inventory.stash", action: "in", id: command.item }],
  };
}

export function applyTrophy(
  draft: Draft<SafehouseState>,
  command: TrophyCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const location = ctx.read<WorldClockState>("world").location;
  const home = draft.homes.find((h) => h.location === location);
  if (!home) return fail("战利品墙在安全屋里，先回去");
  if (draft.trophies.length >= TROPHIES_MAX) return fail(`战利品墙挂满了（${TROPHIES_MAX} 件）`);
  draft.trophies.push({ label: command.label, note: command.note, at: ctx.now });
  return { ok: true, notes: [`${command.label}挂上了${home.name}的战利品墙`] };
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
