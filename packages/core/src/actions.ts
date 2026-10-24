/** 玩家在界面上直接做的操作：不调用模型，结算后作为 action 记录写进日志 */
import type { Patch } from "immer";
import { z } from "zod";
import type { ApplyContext, Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { CharacterStateSchema } from "./systems/character/schema";
import {
  cyberwareCatalog,
  ripperdocList,
  ripperdocShelf,
  tradeInValue,
} from "./systems/cyberware/apply";
import { CyberwareStateSchema } from "./systems/cyberware/schema";
import { AttributeSchema } from "./systems/dice/schema";
import { EconomyStateSchema } from "./systems/economy/schema";
import { registry } from "./systems/registry";

export const PlayerActionSchema = z.discriminatedUnion("type", [
  /** 分配一个街头声望攒下的属性点 */
  z.strictObject({ type: z.literal("spendPoint"), attribute: AttributeSchema }),
  /** 在委托板上接下一单挂着的委托 */
  z.strictObject({ type: z.literal("acceptJob"), id: z.string().min(1).max(64) }),
  /** 在义体医生那里买一件装上；同一部位的旧件换下来折价；credit 是钱不够时赊账 */
  z.strictObject({
    type: z.literal("buyCyberware"),
    doc: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
    credit: z.boolean().optional(),
  }),
  /** 请义体医生卸下一件，医生折价回收 */
  z.strictObject({
    type: z.literal("removeCyberware"),
    doc: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
  }),
  /** 还清欠义体医生的钱 */
  z.strictObject({ type: z.literal("repayRipperdoc"), doc: z.string().min(1).max(40) }),
]);
export type PlayerAction = z.infer<typeof PlayerActionSchema>;

/** POST /api/saves/:id/actions 的请求体 */
export const ActionRequestSchema = z.strictObject({
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  baseVersion: z.number().int().min(0),
  action: PlayerActionSchema,
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** 在委托板上接单时写进进展笔记的一句 */
export const BOARD_ACCEPT_NOTE = "在委托板上接下，戏里还没和对方细谈";

/** 义体医生的操作：人要在诊所里，货要在货架上、肯卖 */
function ripperdocCommands(
  world: WorldState,
  action: Extract<PlayerAction, { type: "buyCyberware" | "removeCyberware" | "repayRipperdoc" }>,
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
  const streetCred = CharacterStateSchema.parse(world.slices.character).streetCred;
  const item = ripperdocShelf(doc, catalog, streetCred, installed).find(
    (i) => i.def.id === action.id,
  );
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

/** 每种操作对应的指令；只放行这里列出的。返回字符串表示操作不成立 */
function commandsFor(
  world: WorldState,
  action: PlayerAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  switch (action.type) {
    case "spendPoint":
      return [{ type: "character.spendPoint", attribute: action.attribute }];
    case "buyCyberware":
    case "removeCyberware":
    case "repayRipperdoc":
      return ripperdocCommands(world, action, data);
    case "acceptJob":
      // 记一条进展笔记，让主持人知道这单是在板上接的，戏里还没谈过
      return [
        { type: "jobAccept", id: action.id },
        { type: "jobNote", id: action.id, note: BOARD_ACCEPT_NOTE },
      ];
  }
}

export type ActionResult =
  | {
      readonly ok: true;
      readonly world: WorldState;
      readonly commands: readonly Command[];
      readonly notes: readonly string[];
      readonly patches: readonly Patch[];
    }
  | { readonly ok: false; readonly reason: string };

/** 结算一个界面操作；任何一条指令不生效，整个操作都不生效 */
export function applyPlayerAction(
  world: WorldState,
  action: PlayerAction,
  ctx: ApplyContext,
): ActionResult {
  const commands = commandsFor(world, action, ctx.data ?? {});
  if (typeof commands === "string") return { ok: false, reason: commands };
  const parsed: Command[] = [];
  for (const raw of commands) {
    const result = registry.parseInternal(raw);
    if (!result.ok) return { ok: false, reason: result.error };
    parsed.push(result.command);
  }
  const applied = registry.applyCommands(world, parsed, ctx);
  const notes: string[] = [];
  for (const { result } of applied.results) {
    if (!result.ok) return { ok: false, reason: result.reason };
    notes.push(...result.notes);
  }
  return { ok: true, world: applied.world, commands: parsed, notes, patches: applied.patches };
}
