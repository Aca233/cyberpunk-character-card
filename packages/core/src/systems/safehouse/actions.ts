import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import { EconomyStateSchema } from "../economy";
import { apartmentList, apartmentLocked } from "./apply";
import { SafehouseStateSchema } from "./schema";
import { ownStorageTargets } from "./storage";

/** 买下一处公寓：人要在那个地点，一次付清，之后就是自己的安全屋 */
export const BuyHomeActionSchema = z.strictObject({
  type: z.literal("buyHome"),
  id: z.string().min(1).max(64),
});

/** 物品栏直接存取：只到身边的自有住所或车辆，不通过按钮远程交接。 */
export const PlaceItemActionSchema = z
  .strictObject({
    type: z.literal("placeItem"),
    action: z.enum(["leave", "take"]),
    item: z.string().min(1).max(120),
    where: z.string().min(1).max(120),
    count: z.number().int().min(1).max(99).optional(),
    source: z.enum(["backpack", "worn", "quick"]).optional(),
  })
  .superRefine((action, ctx) => {
    if (action.source !== undefined && action.action !== "leave") {
      ctx.addIssue({ code: "custom", path: ["source"], message: "只有存放时才指定物品来源" });
    }
    if ((action.source === "worn" || action.source === "quick") && (action.count ?? 1) !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["count"],
        message: "穿着或快捷栏的物品每次只能存放一件",
      });
    }
  });

/** 同地点两个自有容器之间直转（如公寓 ↔ 后备箱）；底层仍走原子 take + leave，任一步失败整体回滚。 */
export const TransferItemActionSchema = z
  .strictObject({
    type: z.literal("transferItem"),
    item: z.string().min(1).max(120),
    from: z.string().min(1).max(120),
    to: z.string().min(1).max(120),
    count: z.number().int().min(1).max(99).optional(),
  })
  .refine((action) => action.from !== action.to, {
    message: "转出与转入位置不能相同",
    path: ["to"],
  });

/** 一条 money 指令最多动多少欧元；更贵的分几笔付 */
const MONEY_STEP = 100_000;

/** 安全屋的操作：买公寓；统一由操作入口结算 */
export const safehouseActions = {
  placeItem: defineAction({
    schema: PlaceItemActionSchema,
    commands: (action, { world, data }) => {
      const target = ownStorageTargets(world, data).find((entry) => entry.target === action.where);
      if (!target) return "只能直接存取自己住所或车辆中的物品，其他交接请在行动里描述";
      const allowed = action.action === "leave" ? target.canStore : target.canTake;
      if (!allowed) return target.blockedReason ?? "现在无法在这里存取物品";
      return [
        {
          type: "itemPlace",
          action: action.action,
          item: action.item,
          count: action.count ?? 1,
          where: target.target,
          ...(action.source !== undefined ? { source: action.source } : {}),
          reason: action.action === "leave" ? "在物品栏存放物品" : "在物品栏取回物品",
        },
      ];
    },
  }),
  transferItem: defineAction({
    schema: TransferItemActionSchema,
    commands: (action, { world, data }) => {
      const targets = ownStorageTargets(world, data);
      const fromTarget = targets.find((entry) => entry.target === action.from);
      const toTarget = targets.find((entry) => entry.target === action.to);
      if (!fromTarget || !toTarget) {
        return "只能直接在自己身边的住所与车辆之间转运物品";
      }
      if (!fromTarget.canTake) {
        return fromTarget.blockedReason ?? `现在无法从${fromTarget.name}取出物品`;
      }
      if (!toTarget.canStore) {
        return toTarget.blockedReason ?? `现在无法将物品存入${toTarget.name}`;
      }
      const count = action.count ?? 1;
      return [
        {
          type: "itemPlace",
          action: "take",
          item: action.item,
          count,
          where: fromTarget.target,
          reason: `从${fromTarget.name}转运至${toTarget.name}`,
        },
        {
          type: "itemPlace",
          action: "leave",
          item: action.item,
          count,
          where: toTarget.target,
          reason: `从${fromTarget.name}转运至${toTarget.name}`,
        },
      ];
    },
  }),
  /** 买公寓：人要在那个地点，这里还没有住处，钱够一次付清 */
  buyHome: defineAction({
    schema: BuyHomeActionSchema,
    commands: (action, { world, data }) => {
      const def = apartmentList(data).find((a) => a.id === action.id);
      if (!def) return `没有叫 ${action.id} 的公寓`;
      const here = (world.slices.world as { location?: unknown } | undefined)?.location;
      if (here !== def.location) return `不在${def.name}那里，先过去看房`;
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "打斗中顾不上买房";
      const homes = SafehouseStateSchema.parse(world.slices.safehouse ?? {}).homes;
      const locked = apartmentLocked(homes, def);
      if (locked) return locked;
      const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
      if (def.price > eddies) return `欧元不够：${def.name}要 ${def.price}，身上只有 ${eddies}`;
      const pay: Command[] = [];
      for (let left = def.price; left > 0; left -= MONEY_STEP) {
        pay.push({ type: "money", delta: -Math.min(left, MONEY_STEP), reason: `买下${def.name}` });
      }
      return [
        ...pay,
        { type: "safehouse.seed", id: def.id, name: def.name, location: def.location },
      ];
    },
  }),
};
