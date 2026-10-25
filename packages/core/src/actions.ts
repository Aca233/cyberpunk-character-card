/** 玩家在界面上直接做的操作：不调用模型，结算后作为 action 记录写进日志 */
import type { Patch } from "immer";
import { z } from "zod";
import type { ApplyContext, Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { CharacterStateSchema } from "./systems/character/schema";
import {
  cyberwareCatalog,
  repairCost,
  ripperdocList,
  ripperdocShelf,
  tradeInValue,
} from "./systems/cyberware/apply";
import { CyberwareStateSchema } from "./systems/cyberware/schema";
import { AttributeSchema } from "./systems/dice/schema";
import { EconomyStateSchema } from "./systems/economy/schema";
import { HealthStateSchema } from "./systems/health/schema";
import {
  currentStock,
  itemCatalog,
  sellValue,
  shopList,
  shopShelf,
} from "./systems/inventory/apply";
import { InventoryStateSchema } from "./systems/inventory/schema";
import { registry } from "./systems/registry";
import { apartmentList, apartmentLocked } from "./systems/safehouse/apply";
import { SafehouseStateSchema } from "./systems/safehouse/schema";

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
  /** 请义体医生修好一件打坏的义体 */
  z.strictObject({
    type: z.literal("repairCyberware"),
    doc: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
  }),
  /** 从背包装上一件：武器写 slot（1–3），治疗品和手雷进快捷栏，服装穿到对应的格子；已在武器格里的切成手持 */
  z.strictObject({
    type: z.literal("equipItem"),
    id: z.string().min(1).max(64),
    slot: z.number().int().min(1).max(3).optional(),
  }),
  /** 把装备栏里的一件放回背包 */
  z.strictObject({ type: z.literal("unequipItem"), id: z.string().min(1).max(64) }),
  /** 存放箱和后备箱：store 从背包放进去，take 拿回背包；where 写安全屋 id 或车的 id */
  z.strictObject({
    type: z.literal("stash"),
    action: z.enum(["store", "take"]),
    item: z.string().min(1).max(64),
    where: z.string().min(1).max(64),
  }),
  /** 整套外观：save 存下身上穿着的，wear 照存下的一次换好 */
  z.strictObject({ type: z.literal("outfit"), action: z.enum(["save", "wear"]) }),
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  z.strictObject({
    type: z.literal("modWeapon"),
    action: z.enum(["attach", "detach"]),
    weapon: z.string().min(1).max(64),
    mod: z.string().min(1).max(64),
  }),
  /** 人物卡上设锚点或取消：add 设为锚点，remove 不再当锚点 */
  z.strictObject({
    type: z.literal("anchor"),
    action: z.enum(["add", "remove"]),
    npc: z.string().min(1).max(64),
  }),
  /** 工作台：dismantle 把背包里的一件拆成零件，tune 用零件给武器升一档稀有度 */
  z.strictObject({
    type: z.literal("craft"),
    action: z.enum(["dismantle", "tune"]),
    id: z.string().min(1).max(64),
  }),
  /** 小队面板：accept、decline 回应入队请求，dismiss 请队员离开，pay 发雇佣型队员的薪水 */
  z.strictObject({
    type: z.literal("squad"),
    action: z.enum(["accept", "decline", "dismiss", "pay"]),
    npc: z.string().min(1).max(64),
  }),
  /** 在商店买一件，放进背包 */
  z.strictObject({
    type: z.literal("buyItem"),
    shop: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
  }),
  /** 把背包里的一件卖给商店 */
  z.strictObject({
    type: z.literal("sellItem"),
    shop: z.string().min(1).max(40),
    id: z.string().min(1).max(64),
  }),
  /** 买下一处公寓：人要在那个地点，一次付清，之后就是自己的安全屋 */
  z.strictObject({ type: z.literal("buyHome"), id: z.string().min(1).max(64) }),
  /** 打开消息：把消息都标成已读 */
  z.strictObject({ type: z.literal("readMessages") }),
  /** 角色卡上的习惯：add 自己写一条，confirm 认下叙事模型的提议，dismiss 不要这条提议，remove 删掉 */
  z.strictObject({
    type: z.literal("habit"),
    action: z.enum(["add", "confirm", "dismiss", "remove"]),
    text: z.string().trim().min(1).max(40),
  }),
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
export const BOARD_ACCEPT_NOTE = "在委托板上接下，正文里还没和对方细谈";

/** 义体医生的操作：人要在诊所里，货要在货架上、肯卖 */
function ripperdocCommands(
  world: WorldState,
  action: Extract<
    PlayerAction,
    { type: "buyCyberware" | "removeCyberware" | "repayRipperdoc" | "repairCyberware" }
  >,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  const doc = ripperdocList(data).find((d) => d.id === action.doc);
  if (!doc) return `没有叫 ${action.doc} 的义体医生`;
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  if (here !== doc.location) return `不在${doc.name}的诊所，先去那里`;
  const crisis = (world.slices.psychosis as { crisis?: { status?: string } | null } | undefined)
    ?.crisis;
  if (action.type === "buyCyberware" && crisis?.status === "recovering") {
    return `刚从危机里被拉回来，恢复期里${doc.name}不肯给你装新义体`;
  }
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

/** 商店的买卖：人要在店里；买的要在货架上、肯卖，卖的只收背包里的 */
function shopCommands(
  world: WorldState,
  action: Extract<PlayerAction, { type: "buyItem" | "sellItem" }>,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  const shop = shopList(data).find((s) => s.id === action.shop);
  if (!shop) return `没有叫 ${action.shop} 的商店`;
  const here = (world.slices.world as { location?: unknown } | undefined)?.location;
  if (here !== shop.location) return `不在${shop.name}，先去那里`;
  const catalog = itemCatalog(data);
  if (action.type === "sellItem") {
    const def = catalog.get(action.id);
    if (!def) return `物品表里没有 ${action.id}`;
    const inventory = InventoryStateSchema.parse(world.slices.inventory);
    if ((inventory.backpack[def.id] ?? 0) < 1) return `背包里没有${def.name}；装备着的先卸下`;
    const lastOne = !inventory.weapons.includes(def.id) && inventory.backpack[def.id] === 1;
    if (lastOne && inventory.mods[def.id] !== undefined) {
      return `${def.name}上还装着改装件，先拆下来再卖`;
    }
    const value = sellValue(def);
    if (value <= 0)
      return def.iconic ? `${def.name}是不朽物品，不卖` : `${shop.name}不收${def.name}`;
    return [
      { type: "item", action: "lose", id: def.id, reason: `卖给${shop.name}` },
      { type: "money", delta: value, reason: `${shop.name}收购${def.name}` },
    ];
  }
  const streetCred = CharacterStateSchema.parse(world.slices.character).streetCred;
  const held = InventoryStateSchema.parse(world.slices.inventory);
  const stock = currentStock(held.shopStock[shop.id], world.time);
  const item = shopShelf(shop, catalog, streetCred, stock).find((i) => i.def.id === action.id);
  if (!item) return `${shop.name}的货架上没有这件`;
  if (item.locked) return `${shop.name}不卖${item.def.name}：${item.locked}`;
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  if (item.price > eddies) return `欧元不够：${item.def.name}要 ${item.price}，身上只有 ${eddies}`;
  return [
    { type: "money", delta: -item.price, reason: `在${shop.name}买${item.def.name}` },
    { type: "item", action: "gain", id: item.def.id, reason: `在${shop.name}买下` },
    { type: "inventory.sold", shop: shop.id, item: item.def.id, at: world.time },
  ];
}

/** 一条 money 指令最多动多少欧元；更贵的分几笔付 */
const MONEY_STEP = 100_000;

/** 买公寓：人要在那个地点，这里还没有住处，钱够一次付清 */
function homeCommands(
  world: WorldState,
  action: Extract<PlayerAction, { type: "buyHome" }>,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
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
  return [...pay, { type: "safehouse.seed", id: def.id, name: def.name, location: def.location }];
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
    case "repairCyberware":
      return ripperdocCommands(world, action, data);
    case "buyItem":
    case "sellItem":
      return shopCommands(world, action, data);
    case "buyHome":
      return homeCommands(world, action, data);
    case "craft": {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "战斗中顾不上拆装";
      if (action.action === "dismantle") return [{ type: "inventory.dismantle", id: action.id }];
      const attributes = (world.slices.character as { attributes?: { tech?: unknown } } | undefined)
        ?.attributes;
      const tech = typeof attributes?.tech === "number" ? attributes.tech : 0;
      return [{ type: "inventory.tune", id: action.id, tech }];
    }
    case "squad": {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat && action.action !== "pay") return "打斗中顾不上，打完再说";
      return [{ type: "squad.member", action: action.action, npc: action.npc }];
    }
    case "anchor": {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat && action.action === "add") return "打斗中顾不上，打完再说";
      return [{ type: "psychosis.anchor", action: action.action, npc: action.npc }];
    }
    case "equipItem":
    case "unequipItem": {
      // 战斗里换装备要花一个动作，只能在行动里说
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "战斗中换装备要花一个动作，在行动里写";
      return [
        {
          type: "item",
          action: action.type === "equipItem" ? "equip" : "unequip",
          id: action.id,
          reason: "在装备栏里换",
          ...(action.type === "equipItem" && action.slot !== undefined
            ? { slot: action.slot }
            : {}),
        },
      ];
    }
    case "stash": {
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
    }
    case "outfit": {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "战斗中换装备要花一个动作，在行动里写";
      return [{ type: "inventory.outfit", action: action.action }];
    }
    case "modWeapon": {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "战斗中来不及改装武器";
      return [
        { type: "inventory.mod", action: action.action, weapon: action.weapon, mod: action.mod },
      ];
    }
    case "readMessages":
      return [{ type: "phone.read" }];
    case "habit":
      return [{ type: "character.habit", action: action.action, text: action.text }];
    case "acceptJob":
      // 记一条进展笔记，让叙事模型知道这单是在板上接的，正文里还没谈过
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
