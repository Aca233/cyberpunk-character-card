import { z } from "zod";
import { type Command, defineAction } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { EconomyStateSchema } from "../economy";
import { shopMood } from "../inventory";
import { merchantAt, WorldClockStateSchema } from "../world";
import { cyberwareCatalog, ripperdocList, ripperdocShelf } from "./apply";
import { clinicMoodLock, quoteCyberware } from "./quote";
import { ArmSideSchema, type CyberwareCommand, CyberwareStateSchema } from "./schema";
import { clinicState } from "./stock";

/** 在义体医生那里买一件装上；物理互斥时替换指定或冲突旧件；credit 是钱不够时赊账；传 forNpc 时直接给同行同伴安装 */
export const BuyCyberwareActionSchema = z.strictObject({
  type: z.literal("buyCyberware"),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).max(64),
  armSide: ArmSideSchema.optional(),
  replace: z.string().min(1).max(64).optional(),
  credit: z.boolean().optional(),
  forNpc: z.string().min(1).max(64).optional(),
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

/** 在义体医生诊所坐上手术椅做一次重度义体神经校准维护（14 天周期） */
export const PayChromeCareActionSchema = z.strictObject({
  type: z.literal("payChromeCare"),
  doc: z.string().min(1).max(100),
});

type RipperdocAction =
  | z.infer<typeof BuyCyberwareActionSchema>
  | z.infer<typeof RemoveCyberwareActionSchema>
  | z.infer<typeof RepayRipperdocActionSchema>
  | z.infer<typeof RepairCyberwareActionSchema>
  | z.infer<typeof PayChromeCareActionSchema>;

const CompanionChromeProbeSchema = z
  .object({
    npcs: z
      .record(
        z.string(),
        z.object({
          id: z.string(),
          name: z.string(),
          alive: z.boolean().default(true),
          met: z.boolean().default(false),
          following: z.boolean().default(false),
          body: z
            .object({
              cyberware: z.array(z.string()).default([]),
            })
            .optional(),
        }),
      )
      .default({}),
  })
  .catch({ npcs: {} });

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
    if (action.forNpc) {
      const location = WorldClockStateSchema.parse(world.slices.world).location;
      if (location === null || !merchantAt(data, doc.id, doc.location, location)) {
        return `当前不在${doc.name}，无法为同伴安装义体`;
      }
      const mood = shopMood(world, data, doc);
      const lock = clinicMoodLock(mood);
      if (lock) return lock;
      const npc = CompanionChromeProbeSchema.parse(world.slices.npc ?? {}).npcs[action.forNpc];
      if (!npc?.met || !npc.alive) return "找不到这位在场的同伴";
      if (!npc.following) return `${npc.name}当前没有与你同行，先结伴同行再为其安装义体`;
      const chrome = npc.body?.cyberware ?? [];
      if (chrome.includes(action.id)) return `${npc.name}已经装了这件义体`;
      if (chrome.length >= 12) return `${npc.name}的义体槽已达上限（最多 12 件）`;
      if (!shelf.includes(action.id)) return `${doc.name}的货架上没有这件义体`;
      const def = cyberwareCatalog(data).get(action.id);
      if (!def) return `义体表里没有 ${action.id}`;
      const price = Math.round((def.price * doc.priceFactor * (mood?.factor ?? 1)) / 100) * 100;
      const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
      if (eddies < price) {
        return `欧元不够：为${npc.name}安装${def.name}需要 ${price.toLocaleString("en-US")} 欧元`;
      }
      const out: Command[] = [];
      if (price > 0) {
        out.push({
          type: "money",
          delta: -price,
          reason: `在${doc.name}为同行同伴${npc.name}安装${def.name}`,
        });
      }
      out.push({ type: "npcChrome", id: npc.id, action: "install", cyberware: action.id });
      return out;
    }
    const item = ripperdocShelf({ ...doc, shelf }, cyberwareCatalog(data), installed).find(
      (i) => i.def.id === action.id,
    );
    if (!item) return `${doc.name}的货架上没有这件`;
    const replaceId = action.replace ?? item.replaces?.id;
    command = {
      type: "cyberware",
      action: "install",
      doc: action.doc,
      id: action.id,
      ...(action.armSide ? { armSide: action.armSide } : {}),
      ...(replaceId ? { replace: replaceId, tradeIn: true } : {}),
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
  } else if (action.type === "payChromeCare") {
    command = {
      type: "cyberware",
      action: "calibrate",
      doc: action.doc,
      reason: "玩家选择按显示报价做义体神经校准维护",
    };
  } else {
    command = { type: "cyberware", action: "repay", doc: action.doc, reason: "玩家选择还清欠款" };
  }
  const result = quoteCyberware(world, data, command);
  if (!result.ok) return result.reason;
  if (result.quote.blocked) return result.quote.blocked;
  return [command];
}
/** 义体医生的操作：买、卸、还账、修与校准；统一由操作入口结算 */
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
  payChromeCare: defineAction({
    schema: PayChromeCareActionSchema,
    commands: (action, { world, data }) => ripperdocCommands(world, action, data),
  }),
};
