import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import { EconomyStateSchema } from "../economy";
import { apartmentList, apartmentLocked } from "./apply";
import { SafehouseStateSchema } from "./schema";

/** 存放箱和后备箱：store 从背包放进去，take 拿回背包；where 写安全屋 id 或车的 id */
export const StashActionSchema = z.strictObject({
  type: z.literal("stash"),
  action: z.enum(["store", "take"]),
  item: z.string().min(1).max(64),
  where: z.string().min(1).max(64),
});

/** 买下一处公寓：人要在那个地点，一次付清，之后就是自己的安全屋 */
export const BuyHomeActionSchema = z.strictObject({
  type: z.literal("buyHome"),
  id: z.string().min(1).max(64),
});

/** 一条 money 指令最多动多少欧元；更贵的分几笔付 */
const MONEY_STEP = 100_000;

/** 安全屋的操作：存放箱进出、买公寓；统一由操作入口结算 */
export const safehouseActions = {
  stash: defineAction({
    schema: StashActionSchema,
    commands: (action, { world }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "战斗中顾不上翻箱子";
      return [
        {
          type: "stash",
          action: action.action,
          item: action.item,
          where: action.where,
          reason: action.action === "store" ? "收起来" : "拿出来带上",
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
