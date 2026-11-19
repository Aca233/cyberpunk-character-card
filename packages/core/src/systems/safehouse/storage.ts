import type { WorldState } from "../../kernel/world";
import { HealthStateSchema } from "../health";
import type { PlacedKind } from "../inventory";
import { TravelStateSchema, vehicleCatalog } from "../travel";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { SafehouseStateSchema } from "./schema";

export interface StorageTarget {
  readonly key: string;
  readonly kind: PlacedKind;
  readonly target: string;
  readonly name: string;
  readonly locationName: string;
  readonly canStore: boolean;
  readonly canTake: boolean;
  readonly blockedReason: string | null;
}

/** 界面存取只操作同地点的自有住所和车辆；与叙事中的顺路取物分开校验。 */
export function ownStorageTargets(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): StorageTarget[] {
  const here = WorldClockStateSchema.parse(world.slices.world).location;
  const homes = SafehouseStateSchema.parse(world.slices.safehouse ?? {}).homes;
  const vehicles = TravelStateSchema.parse(world.slices.travel).vehicles;
  const models = vehicleCatalog(data);
  const places = locationCatalog(data);
  const health = HealthStateSchema.safeParse(world.slices.health);
  const commonBlocked = (world.slices.combat as { active?: unknown } | undefined)?.active
    ? "交战中存取物品需要在行动里描述"
    : !health.success || health.data.condition !== "up"
      ? "当前无法自行存取物品"
      : null;
  const placeName = (location: string | null) =>
    location === null ? "位置未知" : (places.get(location)?.name ?? location);
  const targetCounts = new Map<string, number>();
  for (const entry of [...homes, ...vehicles]) {
    targetCounts.set(entry.id, (targetCounts.get(entry.id) ?? 0) + 1);
  }
  const accessReason = (id: string, location: string | null): string | null =>
    commonBlocked ??
    ((targetCounts.get(id) ?? 0) > 1
      ? "存放位置标识重复，请通过行动说明交接位置"
      : here === null || location === null || location !== here
        ? `需前往${placeName(location)}才能存取`
        : null);

  return [
    ...homes.map((home): StorageTarget => {
      const blockedReason = accessReason(home.id, home.location);
      return {
        key: `home:${home.id}`,
        kind: "home",
        target: home.id,
        name: home.name,
        locationName: placeName(home.location),
        canStore: blockedReason === null,
        canTake: blockedReason === null,
        blockedReason,
      };
    }),
    ...vehicles.map((vehicle): StorageTarget => {
      const accessBlocked = accessReason(vehicle.id, vehicle.location);
      const unusable = vehicle.abandoned || vehicle.condition === "wrecked";
      return {
        key: `vehicle:${vehicle.id}`,
        kind: "vehicle",
        target: vehicle.id,
        name: models.get(vehicle.model)?.name ?? vehicle.model,
        locationName: placeName(vehicle.location),
        canStore: accessBlocked === null && !unusable,
        canTake: accessBlocked === null,
        blockedReason:
          accessBlocked ?? (unusable ? "车辆已报废或弃置，只能取回现场留存的物品" : null),
      };
    }),
  ];
}
