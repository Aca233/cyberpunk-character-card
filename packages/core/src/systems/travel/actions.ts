import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { EconomyStateSchema } from "../economy";
import {
  locationForTravel,
  serviceAnchors,
  WorldClockStateSchema,
  withSavedPlaces,
} from "../world";
import { TravelStateSchema, type VehicleClass, type VehicleDef } from "./schema";
import { vehicleCatalog } from "./vehicles";

/** 好车中间人终端直接购车：人在 autofixer 终端，一次付清，车辆直接交付停放于当前地点 */
export const BuyVehicleActionSchema = z.strictObject({
  type: z.literal("buyVehicle"),
  model: z.string().min(1).max(64),
});

/** 呼叫名下车辆开到当前位置：仅限同城非报废/非弃置/非偷窃车，不可呼叫进封闭室内或跨封锁区 */
export const CallVehicleActionSchema = z.strictObject({
  type: z.literal("callVehicle"),
  id: z.string().min(1).max(64),
});

interface ServicePointLike {
  readonly id: string;
  readonly kind: string;
  readonly name: string | null;
  readonly district: string | null;
}

function autofixerPointAt(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
): ServicePointLike | null {
  if (!location?.startsWith("poi:")) return null;
  const rawId = location.slice(4);
  const points = Array.isArray(data.servicePoints)
    ? (data.servicePoints as readonly ServicePointLike[])
    : [];
  const found = points.find((p) => p.id === rawId && p.kind === "autofixer");
  if (found) return found;
  const anchor = serviceAnchors(data).find((a) => a.id === location && a.kind === "autofixer");
  return anchor ? { id: rawId, kind: "autofixer", name: null, district: null } : null;
}

const DISTRICT_CLASSES: Readonly<Record<string, readonly VehicleClass[]>> = {
  city_center: ["executive", "sport", "hyper", "moto"],
  westbrook: ["executive", "sport", "hyper", "moto"],
  watson: ["economy", "sport", "moto"],
  heywood: ["economy", "executive", "sport", "moto"],
  santo_domingo: ["economy", "offroad", "sport", "moto"],
  pacifica: ["economy", "offroad", "moto"],
  dogtown: ["offroad", "sport", "moto"],
  badlands: ["economy", "offroad", "moto"],
};

/** 当前地点是否为好车中间人终端；是则返回按区域筛选的在售车型清单 */
export function autofixerCatalogAt(
  data: Readonly<Record<string, unknown>>,
  location: string | null,
): { readonly id: string; readonly name: string; readonly vehicles: readonly VehicleDef[] } | null {
  const point = autofixerPointAt(data, location);
  if (!point) return null;
  const all = [...vehicleCatalog(data).values()];
  const allowed = DISTRICT_CLASSES[point.district ?? "badlands"];
  const vehicles = allowed ? all.filter((v) => allowed.includes(v.class)) : all;
  return {
    id: `poi:${point.id}`,
    name: point.name ?? "好车中间人终端",
    vehicles: vehicles.length > 0 ? vehicles : all,
  };
}

export const travelActions = {
  buyVehicle: defineAction({
    schema: BuyVehicleActionSchema,
    commands: (action, { world, data }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "交战中无法操作好车中间人终端";
      const location = WorldClockStateSchema.parse(world.slices.world).location;
      const terminal = autofixerCatalogAt(data, location);
      if (!terminal) return "不在好车中间人终端附近，无法直接购车";
      const def = terminal.vehicles.find((v) => v.id === action.model);
      if (!def) return `该终端当前未上架车型 ${action.model}`;
      const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
      if (def.price > eddies) {
        return `欧元不够：${def.name}要 ${def.price} 欧元，身上只有 ${eddies} 欧元`;
      }
      return [
        {
          type: "vehicle",
          action: "buy",
          model: def.id,
          reason: `在${terminal.name}购入${def.name}`,
        },
      ];
    },
  }),
  callVehicle: defineAction({
    schema: CallVehicleActionSchema,
    commands: (action, { world, data }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "交战中无法呼叫车辆自动驶来";
      const location = WorldClockStateSchema.parse(world.slices.world).location;
      if (!location) return "当前位置未知，车辆无法定位";
      const travel = TravelStateSchema.parse(world.slices.travel);
      const car = travel.vehicles.find((v) => v.id === action.id);
      if (!car) return `名下没有编号 ${action.id} 的车辆`;
      if (car.abandoned) return "这辆车已经弃置，无法远程呼叫";
      if (car.stolen) return "偷来的车未绑定你的神经密钥，无法远程呼叫";
      if (car.condition === "wrecked") return "这辆车已经报废，开不过来";
      if (car.location === null) return "这辆车当前失去定位信号，无法远程呼叫";
      if (car.location === location) return "这辆车已经停在附近了";
      const travelData = withSavedPlaces(data, world);
      const isDogtown = (loc: string | null): boolean => {
        if (!loc) return false;
        if (loc === "dogtown") return true;
        return locationForTravel(travelData, loc)?.district === "狗镇";
      };
      if (isDogtown(location) !== isDogtown(car.location)) {
        const factions = world.slices.factions as
          | { readonly stances?: Readonly<Record<string, { readonly attitude?: string }>> }
          | undefined;
        const barghest = factions?.stances?.barghest?.attitude;
        if (barghest === "hostile" || barghest === "kos") {
          return "幽冥犬对你敌对，狗镇关口拦截了无人驶入的车辆，无法跨区呼叫";
        }
      }
      return [{ type: "vehicle.summon", id: car.id, to: location }];
    },
  }),
};
