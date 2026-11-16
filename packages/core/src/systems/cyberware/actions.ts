import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { cyberwareCatalog, ripperdocList, ripperdocShelf } from "./apply";
import { quoteCyberware } from "./quote";
import { type CyberwareCommand, CyberwareStateSchema } from "./schema";
import { clinicState } from "./stock";

/** 在义体医生那里买一件装上；部位装满了（SLOT_CAPACITY）才换下最早装的那件折价；credit 是钱不够时赊账 */
export const BuyCyberwareActionSchema = z.strictObject({
  type: z.literal("buyCyberware"),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).max(64),
  credit: z.boolean().optional(),
});

/** 请义体医生卸下一件，医生折价回收 */
export const RemoveCyberwareActionSchema = z.strictObject({
  type: z.literal("removeCyberware"),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).max(64),
});

/** 还清欠义体医生的钱 */
export const RepayRipperdocActionSchema = z.strictObject({
  type: z.literal("repayRipperdoc"),
  doc: z.string().min(1).max(100),
});

/** 请义体医生修好一件打坏的义体 */
export const RepairCyberwareActionSchema = z.strictObject({
  type: z.literal("repairCyberware"),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).max(64),
});

type RipperdocAction =
  | z.infer<typeof BuyCyberwareActionSchema>
  | z.infer<typeof RemoveCyberwareActionSchema>
  | z.infer<typeof RepayRipperdocActionSchema>
  | z.infer<typeof RepairCyberwareActionSchema>;

/** 现有按钮确认框已经展示将出售的旧件；转换为与正文相同的交易指令。 */
function ripperdocCommands(
  world: WorldState,
  action: RipperdocAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  let command: CyberwareCommand;
  if (action.type === "buyCyberware") {
    const state = CyberwareStateSchema.parse(world.slices.cyberware);
    const doc = ripperdocList(data, state).find((d) => d.id === action.doc);
    if (!doc) return `没有叫 ${action.doc} 的义体医生`;
    const installed = state.installed;
    const stock = clinicState(state, doc, world.time).stock;
    const shelf = [
      ...new Set([
        ...doc.shelf,
        ...Object.keys(stock),
        ...Object.values(state.parts)
          .filter((part) => part.holder === doc.id)
          .map((part) => part.model),
      ]),
    ];
    const item = ripperdocShelf({ ...doc, shelf }, cyberwareCatalog(data), installed).find(
      (i) => i.def.id === action.id,
    );
    if (!item) return `${doc.name}的货架上没有这件`;
    command = {
      type: "cyberware",
      action: "install",
      doc: action.doc,
      id: action.id,
      replace: item.replaces?.id,
      tradeIn: item.replaces ? true : undefined,
      credit: action.credit,
      reason: "玩家确认诊所货架的安装条件",
    };
  } else if (action.type === "removeCyberware") {
    command = {
      type: "cyberware",
      action: "remove",
      doc: action.doc,
      id: action.id,
      tradeIn: true,
      reason: "玩家选择卸下并按显示条件回收",
    };
  } else if (action.type === "repairCyberware") {
    command = {
      type: "cyberware",
      action: "repair",
      doc: action.doc,
      id: action.id,
      reason: "玩家选择按显示报价维修",
    };
  } else {
    command = { type: "cyberware", action: "repay", doc: action.doc, reason: "玩家选择还清欠款" };
  }
  const result = quoteCyberware(world, data, command);
  if (!result.ok) return result.reason;
  if (result.quote.blocked) return result.quote.blocked;
  return [command];
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
