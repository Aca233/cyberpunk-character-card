import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { EconomyStateSchema } from "../economy";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog, repairCost, ripperdocList, ripperdocShelf, tradeInValue } from "./apply";
import { CyberwareStateSchema } from "./schema";

/** 在义体医生那里买一件装上；部位装满了（SLOT_CAPACITY）才换下最早装的那件折价；credit 是钱不够时赊账 */
export const BuyCyberwareActionSchema = z.strictObject({
  type: z.literal("buyCyberware"),
  doc: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
  credit: z.boolean().optional(),
});

/** 请义体医生卸下一件，医生折价回收 */
export const RemoveCyberwareActionSchema = z.strictObject({
  type: z.literal("removeCyberware"),
  doc: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
});

/** 还清欠义体医生的钱 */
export const RepayRipperdocActionSchema = z.strictObject({
  type: z.literal("repayRipperdoc"),
  doc: z.string().min(1).max(40),
});

/** 请义体医生修好一件打坏的义体 */
export const RepairCyberwareActionSchema = z.strictObject({
  type: z.literal("repairCyberware"),
  doc: z.string().min(1).max(40),
  id: z.string().min(1).max(64),
});

type RipperdocAction =
  | z.infer<typeof BuyCyberwareActionSchema>
  | z.infer<typeof RemoveCyberwareActionSchema>
  | z.infer<typeof RepayRipperdocActionSchema>
  | z.infer<typeof RepairCyberwareActionSchema>;

/** 义体医生的操作：人要在诊所里，货要在货架上、肯卖 */
function ripperdocCommands(
  world: WorldState,
  action: RipperdocAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  const doc = ripperdocList(data).find((d) => d.id === action.doc);
  if (!doc) return `没有叫 ${action.doc} 的义体医生`;
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  if (here !== doc.location) return `不在${doc.name}的诊所，先去那里`;
  const catalog = cyberwareCatalog(data);
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const installed = state.installed;
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  const debt = state.debts.find((d) => d.doc === doc.id);
  if (action.type === "repayRipperdoc") {
    if (!debt) return `不欠${doc.name}的钱`;
    if (debt.amount > eddies) return `欧元不够：欠${doc.name} ${debt.amount}，身上只有 ${eddies}`;
    return [
      { type: "money", delta: -debt.amount, reason: `还清欠${doc.name}的义体钱` },
      { type: "cyberware.debt", action: "repay", doc: doc.id, docName: doc.name },
    ];
  }
  if (action.type === "repairCyberware") {
    const def = catalog.get(action.id);
    const name = def?.name ?? action.id;
    if (!installed.some((c) => c.id === action.id)) return `没有装着${name}`;
    if (!HealthStateSchema.parse(world.slices.health).brokenChrome.includes(action.id)) {
      return `${name}没坏`;
    }
    const cost = def ? repairCost(def) : 0;
    if (cost > eddies) return `欧元不够：修${name}要 ${cost}，身上只有 ${eddies}`;
    return [
      ...(cost > 0 ? [{ type: "money", delta: -cost, reason: `在${doc.name}那里修${name}` }] : []),
      { type: "health.limb", action: "repair", id: action.id, name },
    ];
  }
  if (action.type === "removeCyberware") {
    const def = catalog.get(action.id);
    if (!installed.some((c) => c.id === action.id)) return `没有装着${def?.name ?? action.id}`;
    const buyback = def ? tradeInValue(def) : 0;
    return [
      {
        type: "cyberware",
        action: "remove",
        id: action.id,
        reason: `在${doc.name}那里卸下`,
      },
      ...(buyback > 0
        ? [{ type: "money", delta: buyback, reason: `${doc.name}折价回收${def?.name}` }]
        : []),
    ];
  }
  const item = ripperdocShelf(doc, catalog, installed).find((i) => i.def.id === action.id);
  if (!item) return `${doc.name}的货架上没有这件`;
  if (item.locked) return `${doc.name}不卖${item.def.name}：${item.locked}`;
  if (item.installed) return `${item.def.name}已经装着了`;
  const reason = `在${doc.name}那里装上${item.def.name}${item.replaces && item.tradeIn > 0 ? `，${item.replaces.name}抵 ${item.tradeIn}` : ""}`;
  if (item.net <= eddies) {
    return [{ type: "cyberware", action: "install", id: action.id, price: item.net, reason }];
  }
  // 钱不够：先付身上全部的钱，剩下的赊着
  const owed = item.net - eddies;
  if (!action.credit) return `欧元不够：${item.def.name}要 ${item.net}，身上只有 ${eddies}`;
  if (doc.credit === 0) return `${doc.name}不赊账`;
  if (debt) return `还欠着${doc.name} ${debt.amount} 欧元，先还清才能再赊`;
  if (owed > doc.credit) return `${doc.name}最多赊 ${doc.credit} 欧元，还差 ${owed}`;
  return [
    { type: "cyberware", action: "install", id: action.id, price: eddies, reason },
    {
      type: "cyberware.debt",
      action: "add",
      doc: doc.id,
      docName: doc.name,
      amount: owed,
      item: item.def.name,
    },
  ];
}

/** 义体医生的操作：买、卸、还账、修；统一由操作入口结算 */
export const cyberwareActions = {
  buyCyberware: defineAction({
    schema: BuyCyberwareActionSchema,
    commands: (action, { world, data }) => ripperdocCommands(world, action, data),
  }),
  removeCyberware: defineAction({
    schema: RemoveCyberwareActionSchema,
    commands: (action, { world, data }) => ripperdocCommands(world, action, data),
  }),
  repayRipperdoc: defineAction({
    schema: RepayRipperdocActionSchema,
    commands: (action, { world, data }) => ripperdocCommands(world, action, data),
  }),
  repairCyberware: defineAction({
    schema: RepairCyberwareActionSchema,
    commands: (action, { world, data }) => ripperdocCommands(world, action, data),
  }),
};
