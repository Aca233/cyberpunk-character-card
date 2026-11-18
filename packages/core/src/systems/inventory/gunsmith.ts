import type { Draft } from "immer";
import { z } from "zod";
import type { ApplyOutcome, Command } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { agreedQuote, checkNarratedPurchase, type NarratedPurchase } from "../commerce";
import { EconomyStateSchema, MONEY_CAP, RARITY_LABELS, type Rarity } from "../economy";
import { LogisticsStateSchema } from "../logistics";
import { merchantAt, merchantSites, type WorldClockState } from "../world";
import {
  defaultInstanceStateFromDef,
  foldBackWeapon,
  itemCatalog,
  materializeWeapon,
  putToBackpack,
  rarityOf,
  shopList,
  takeFromBackpack,
  withWorldObjects,
} from "./apply";
import { ensureMerchant, merchantState, shopUnavailable, withMerchants } from "./merchants";
import { moodLock, moodPrice, type ShopMood, shopMood } from "./mood";
import {
  canAttachMod,
  type InventoryState,
  InventoryStateSchema,
  type ItemDef,
  MOD_SLOT_LABELS,
  type ModSlot,
  ModSlotSchema,
  type Shop,
  WEAPON_TYPE_LABELS,
  type WeaponInstanceState,
  weaponGrantsSmartLink,
} from "./schema";
import { collectOrderedItem, replenishAfterSale } from "./supply";
import { nextRarity, SMART_LINK_CONVERT_PARTS, tuneStepRawFee } from "./trade";

export const GUNSMITH_SERVICE_RATE = 0.2;
const MELEE_CATEGORIES = new Set(["blade", "blunt"]);

export const GunsmithActionSchema = z.strictObject({
  type: z.literal("gunsmith"),
  shop: z.string().min(1).max(80),
  action: z.enum(["install", "detach", "tune", "convert"]),
  weapon: z.string().min(1).max(64),
  mod: z.string().min(1).max(64).optional(),
  slot: ModSlotSchema.optional(),
  source: z.enum(["shelf", "backpack"]).optional(),
  replace: z.string().min(1).max(64).optional(),
  lock: z.boolean().optional(),
  conversion: z.enum(["smart-link", "precision-lock"]).optional(),
});
export type GunsmithAction = z.infer<typeof GunsmithActionSchema>;

export const GunsmithCommandSchema = z
  .strictObject({
    type: z.literal("gunsmith"),
    shop: z.string().min(1).max(80).describe("提供枪匠工坊服务的商店稳定 id"),
    action: z
      .enum(["install", "detach", "tune", "convert"])
      .describe(
        "install 从货架购买或用自带件安装/替换改装件；detach 拆除已锁定改装件并解锁槽位；tune 付费精调提升武器品质一档；convert 为智能武器加装智能靶向联锁或精工固锁已有改装槽位",
      ),
    weapon: z.string().min(1).max(64).describe("随身携带的武器 id（模板 id 或定制实例 id）"),
    mod: z.string().min(1).max(64).optional().describe("install/detach 对应的改装件 id"),
    slot: ModSlotSchema.optional().describe("detach 或 convert(precision-lock) 指定的槽位"),
    source: z
      .enum(["shelf", "backpack"])
      .optional()
      .describe("install 时配件来源：默认 shelf 商店货架购买，backpack 玩家背包自带件"),
    replace: z.string().min(1).max(64).optional().describe("同槽位替换时原有的旧改装件 id"),
    lock: z.boolean().optional().describe("install 时是否顺带由枪匠精工固锁该槽位"),
    conversion: z
      .enum(["smart-link", "precision-lock"])
      .optional()
      .describe("convert 改造方式：smart-link 智能靶向联锁，precision-lock 槽位精工固锁"),
    offer: z.string().min(1).max(80).optional().describe("引用已谈妥报价的 id"),
    reason: z.string().min(1),
  })
  .describe(
    "枪匠工坊定制服务：由商店与共同报价决定价格、现货与条件，不另发 money、item 或 trade 重复结算。",
  );
export type GunsmithCommand = z.infer<typeof GunsmithCommandSchema>;

export type GunsmithQuoteRequest = Omit<GunsmithCommand, "type" | "reason">;

export interface GunsmithQuote {
  readonly action: GunsmithQuoteRequest["action"];
  readonly shop: string;
  readonly shopName: string;
  readonly weapon: string;
  readonly weaponName: string;
  readonly baseId: string;
  readonly mod: string | null;
  readonly modName: string | null;
  readonly slot: ModSlot | null;
  readonly source: "shelf" | "backpack" | null;
  readonly replaces: { readonly id: string; readonly name: string } | null;
  readonly lock: boolean;
  readonly conversion: "smart-link" | "precision-lock" | null;
  readonly tunedRarity: Rarity | null;
  readonly quoteTarget: string;
  readonly label: string;
  readonly partsFee: number;
  readonly serviceFee: number;
  readonly total: number;
  readonly offer: string | null;
  readonly blocked: string | null;
}

export type GunsmithQuoteResult =
  | { readonly ok: true; readonly quote: GunsmithQuote }
  | { readonly ok: false; readonly reason: string };

/** 只有威尔逊、阿涛及武器/近战专卖店提供枪匠工坊服务 */
export function isGunsmithShop(shop: Shop, data: Readonly<Record<string, unknown>>): boolean {
  if (shop.id === "wilson" || shop.id === "kabuki-arms") return true;
  const kind = merchantSites(data).get(shop.id)?.kind;
  return kind === "gun" || kind === "melee";
}

function shopAdjustedPrice(raw: number, shop: Shop, mood: ShopMood | undefined): number {
  return moodPrice(Math.max(10, Math.round((raw * shop.priceFactor) / 10) * 10), mood);
}

function laborFee(rawBase: number, shop: Shop, mood: ShopMood | undefined): number {
  const raw = Math.max(100, Math.round((rawBase * GUNSMITH_SERVICE_RATE) / 10) * 10);
  return shopAdjustedPrice(raw, shop, mood);
}

function resolveGunsmithShop(
  world: WorldState,
  rawData: Readonly<Record<string, unknown>>,
  shopId: string,
):
  | {
      readonly ok: true;
      readonly shop: Shop;
      readonly data: Readonly<Record<string, unknown>>;
      readonly inventory: InventoryState;
      readonly catalog: ReadonlyMap<string, ItemDef>;
      readonly mood: ShopMood | undefined;
    }
  | { readonly ok: false; readonly reason: string } {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const data = withWorldObjects(withMerchants(rawData, inventory.merchants), inventory.objects);
  const shop = shopList(data).find((s) => s.id === shopId);
  if (!shop) return { ok: false, reason: `没有叫 ${shopId} 的商店` };
  if (!isGunsmithShop(shop, data)) return { ok: false, reason: `${shop.name}不提供枪匠工坊服务` };
  const location = (world.slices.world as WorldClockState).location;
  if (location === null || !merchantAt(data, shop.id, shop.location, location)) {
    return { ok: false, reason: `不在${shop.name}，先去那里` };
  }
  const catalog = itemCatalog(data);
  const merchant = merchantState(inventory, shop, catalog, world.time);
  if (!merchant.open)
    return { ok: false, reason: merchant.closureReason ?? `${shop.name}目前暂停营业` };
  const unavailable = shopUnavailable(world, shop, data);
  if (unavailable) return { ok: false, reason: unavailable };
  const mood = shopMood(world, data, shop);
  const locked = moodLock(mood);
  if (locked) return { ok: false, reason: `${shop.name}拒绝交易：${locked}` };
  return { ok: true, shop, data, inventory, catalog, mood };
}

/** 查询当前地点下某家商店的枪匠工坊可用性；可用返回 null，否则返回阻断原因 */
export function gunsmithAvailability(
  world: WorldState,
  shop: Shop,
  data: Readonly<Record<string, unknown>>,
): string | null {
  const resolved = resolveGunsmithShop(world, data, shop.id);
  return resolved.ok ? null : resolved.reason;
}

/** 只读报价：界面工坊页签、确定性操作与叙事抽取共用同一计算真源 */
export function quoteGunsmith(
  world: WorldState,
  rawData: Readonly<Record<string, unknown>>,
  request: GunsmithQuoteRequest,
  options: { readonly checkFunds?: boolean } = {},
): GunsmithQuoteResult {
  const resolved = resolveGunsmithShop(world, rawData, request.shop);
  if (!resolved.ok) return resolved;
  const { shop, inventory, catalog, mood } = resolved;

  const weaponObj = inventory.objects[request.weapon];
  const weaponDef = catalog.get(request.weapon) ?? weaponObj?.definition;
  if (weaponDef?.kind !== "weapon" || weaponDef.category === undefined) {
    return { ok: false, reason: `没有武器 ${request.weapon}` };
  }
  const carried = inventory.backpack[request.weapon] ?? 0;
  if (carried < 1 || (weaponObj && weaponObj.holder !== "player")) {
    return { ok: false, reason: `随身背包里没有${weaponDef.name}` };
  }
  const baseId = weaponObj?.weaponState?.baseId ?? weaponDef.id;
  const ws = weaponObj?.weaponState ?? defaultInstanceStateFromDef(weaponDef);
  const merchant = merchantState(inventory, shop, catalog, world.time);

  let modId: string | null = null;
  let modName: string | null = null;
  let slot: ModSlot | null = null;
  let source: "shelf" | "backpack" | null = null;
  let replaces: GunsmithQuote["replaces"] = null;
  let lock = false;
  let conversion: GunsmithQuote["conversion"] = null;
  let tunedRarity: Rarity | null = null;
  let quoteTarget = request.weapon;
  let label = weaponDef.name;
  let partsFee: number | undefined = 0;
  let serviceFee = 0;

  if (request.action === "install") {
    if (!request.mod) return { ok: false, reason: "安装改装件需要指定 mod" };
    if (request.conversion) return { ok: false, reason: "安装改装件不接受改造模式参数" };
    const modDef = catalog.get(request.mod);
    if (modDef?.kind !== "mod" || modDef.modSlot === undefined) {
      return { ok: false, reason: `没有改装件 ${request.mod}` };
    }
    if (request.slot !== undefined && request.slot !== modDef.modSlot) {
      return {
        ok: false,
        reason: `${modDef.name} 只能装到${MOD_SLOT_LABELS[modDef.modSlot]}，不能装到${MOD_SLOT_LABELS[request.slot]}`,
      };
    }
    const attachCheck = canAttachMod(weaponDef, modDef, ws, { ignoreLock: true });
    if (!attachCheck.ok) return attachCheck;
    slot = attachCheck.slot;
    modId = modDef.id;
    modName = modDef.name;
    quoteTarget = modDef.id;
    source = request.source ?? "shelf";
    lock = request.lock === true;
    const isSlotLocked = ws?.lockedSlots.includes(slot) ?? false;
    if (ws?.mods[slot] === modDef.id) {
      return { ok: false, reason: `${weaponDef.name}上已经装着${modDef.name}` };
    }
    const existingModId = ws?.mods[slot];
    if (request.replace !== undefined && existingModId !== request.replace) {
      return {
        ok: false,
        reason: `${weaponDef.name}的${MOD_SLOT_LABELS[slot]}当前没有装着 ${request.replace}`,
      };
    }
    if (existingModId) {
      replaces = { id: existingModId, name: catalog.get(existingModId)?.name ?? existingModId };
    }
    if (source === "shelf") {
      if ((merchant.stock[modDef.id] ?? 0) < 1) {
        return { ok: false, reason: `${shop.name}没有${modDef.name}的现货` };
      }
      partsFee =
        modDef.price !== undefined ? shopAdjustedPrice(modDef.price, shop, mood) : undefined;
      serviceFee = isSlotLocked || lock ? laborFee(modDef.price ?? 500, shop, mood) : 0;
    } else {
      if ((inventory.backpack[modDef.id] ?? 0) < 1) {
        return { ok: false, reason: `背包里没有${modDef.name}` };
      }
      if (!isSlotLocked && !lock) {
        return {
          ok: false,
          reason: "该槽位未锁定，背包里的改装件可在物品栏直接免费装卸",
        };
      }
      partsFee = 0;
      serviceFee = laborFee(modDef.price ?? 500, shop, mood);
    }
    label = `${weaponDef.name} ${replaces ? "换装" : "加装"} ${modDef.name}`;
  } else if (request.action === "detach") {
    if (request.replace || request.source || request.lock || request.conversion) {
      return { ok: false, reason: "拆除锁定改装件不接受换装、来源或固锁参数" };
    }
    if (!request.mod && !request.slot) {
      return { ok: false, reason: "拆除锁定改装件需要指定 mod 或 slot" };
    }
    const modsEntries = Object.entries(ws?.mods ?? {}) as [ModSlot, string | undefined][];
    const matched = request.mod
      ? modsEntries.find(([s, m]) => m === request.mod && (!request.slot || s === request.slot))
      : request.slot
        ? ([request.slot, ws?.mods[request.slot]] as [ModSlot, string | undefined])
        : undefined;
    const foundSlot = matched?.[0];
    const foundModId = matched?.[1];
    if (!foundSlot || !foundModId) {
      return { ok: false, reason: `${weaponDef.name}上没有安装指定改装件` };
    }
    if (!ws?.lockedSlots.includes(foundSlot)) {
      return {
        ok: false,
        reason: `${weaponDef.name}的${MOD_SLOT_LABELS[foundSlot]}未锁定，可在物品栏直接免费拆下`,
      };
    }
    const modDef = catalog.get(foundModId);
    slot = foundSlot;
    modId = foundModId;
    modName = modDef?.name ?? foundModId;
    quoteTarget = foundModId;
    partsFee = 0;
    serviceFee = laborFee(modDef?.price ?? 500, shop, mood);
    label = `${weaponDef.name} 拆下并解锁 ${modName}`;
  } else if (request.action === "tune") {
    if (
      request.mod ||
      request.slot ||
      request.source ||
      request.replace ||
      request.lock ||
      request.conversion
    ) {
      return { ok: false, reason: "精调升阶只指定武器，不接受配件或槽位参数" };
    }
    const currentRarity = rarityOf(weaponDef, ws);
    const next = nextRarity(currentRarity);
    if (!next) {
      return { ok: false, reason: `${weaponDef.name}已经达到传说级，无法继续精调升阶` };
    }
    tunedRarity = next;
    partsFee = 0;
    serviceFee = shopAdjustedPrice(tuneStepRawFee(weaponDef, currentRarity), shop, mood);
    label = `${weaponDef.name} 精调至${RARITY_LABELS[next]}`;
  } else {
    if (request.mod || request.source || request.replace || request.lock) {
      return { ok: false, reason: "枪匠结构改造不接受改装件来源或替换参数" };
    }
    conversion = request.conversion ?? (request.slot ? "precision-lock" : "smart-link");
    if (conversion === "smart-link") {
      if (request.slot !== undefined) {
        return { ok: false, reason: "智能靶向联锁模块不占用常规改装槽位" };
      }
      if (weaponDef.weaponType !== "smart") {
        return {
          ok: false,
          reason: `${weaponDef.name}不是${WEAPON_TYPE_LABELS.smart}武器，无法加装智能靶向联锁模块`,
        };
      }
      if (weaponGrantsSmartLink(weaponDef, ws, catalog)) {
        return { ok: false, reason: `${weaponDef.name}已经具备智能靶向联锁能力` };
      }
      partsFee = shopAdjustedPrice(SMART_LINK_CONVERT_PARTS, shop, mood);
      serviceFee = laborFee(SMART_LINK_CONVERT_PARTS, shop, mood);
      label = `${weaponDef.name} 加装智能靶向联锁模块`;
    } else {
      if (!request.slot) {
        return { ok: false, reason: "精工固锁需要指定改装槽位" };
      }
      if (MELEE_CATEGORIES.has(weaponDef.category)) {
        return { ok: false, reason: "精工固锁改造仅适用于远程枪械" };
      }
      const installedModId = ws?.mods[request.slot];
      if (!installedModId) {
        return {
          ok: false,
          reason: `${weaponDef.name}的${MOD_SLOT_LABELS[request.slot]}没有安装改装件，无法固锁`,
        };
      }
      if (ws?.lockedSlots.includes(request.slot)) {
        return {
          ok: false,
          reason: `${weaponDef.name}的${MOD_SLOT_LABELS[request.slot]}已经锁定`,
        };
      }
      const installedModDef = catalog.get(installedModId);
      slot = request.slot;
      partsFee = 0;
      serviceFee = laborFee(installedModDef?.price ?? 500, shop, mood);
      label = `${weaponDef.name} 精工固锁${MOD_SLOT_LABELS[request.slot]}`;
    }
  }

  let agreement = agreedQuote(world, {
    seller: shop.id,
    kind: "gunsmith",
    action: request.action,
    target: quoteTarget,
    ...(request.offer ? { offer: request.offer } : {}),
  });
  if (!agreement.ok) return agreement;
  if (
    !agreement.quote &&
    request.offer === undefined &&
    (request.action === "tune" || request.action === "convert") &&
    baseId !== request.weapon
  ) {
    const fallback = agreedQuote(world, {
      seller: shop.id,
      kind: "gunsmith",
      action: request.action,
      target: baseId,
    });
    if (fallback.ok && fallback.quote) {
      agreement = fallback;
      quoteTarget = baseId;
    }
  }

  const computedTotal = partsFee !== undefined ? partsFee + serviceFee : undefined;
  const total = agreement.quote?.price ?? computedTotal;
  if (
    total === undefined ||
    total < 0 ||
    (total === 0 && !agreement.quote) ||
    !Number.isSafeInteger(total)
  ) {
    return { ok: false, reason: "这项枪匠服务没有有效现金报价，须先商定报价" };
  }
  let resolvedPartsFee = partsFee ?? 0;
  let resolvedServiceFee = serviceFee;
  if (agreement.quote) {
    if (total < resolvedPartsFee) {
      resolvedPartsFee = total;
      resolvedServiceFee = 0;
    } else {
      resolvedServiceFee = total - resolvedPartsFee;
    }
  }

  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  let blocked: string | null = null;
  if (total > eddies && options.checkFunds !== false) {
    blocked = `欧元不够：${label}要 ${total}，身上只有 ${eddies}`;
  }
  if (total > MONEY_CAP) {
    blocked = `本次现金对价超过单笔 ${MONEY_CAP} 欧元的结算范围，需要重新约定交易条件`;
  }

  return {
    ok: true,
    quote: {
      action: request.action,
      shop: shop.id,
      shopName: shop.name,
      weapon: request.weapon,
      weaponName: weaponDef.name,
      baseId,
      mod: modId,
      modName,
      slot,
      source,
      replaces,
      lock,
      conversion,
      tunedRarity,
      quoteTarget,
      label,
      partsFee: resolvedPartsFee,
      serviceFee: resolvedServiceFee,
      total,
      offer: agreement.quote?.id ?? null,
      blocked,
    },
  };
}

/** 转为与 commerce/quotes.ts 对账的不可变条款 */
export function gunsmithSettlement(q: GunsmithQuote): NarratedPurchase {
  return {
    seller: q.shop,
    kind: "gunsmith",
    action: q.action,
    target: q.quoteTarget,
    price: q.total,
    weapon: q.weapon,
    ...(q.mod ? { mod: q.mod } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.slot ? { slot: q.slot } : {}),
    ...(q.replaces ? { replace: q.replaces.id } : {}),
    ...(q.conversion ? { conversion: q.conversion } : {}),
    ...(q.tunedRarity ? { tunedRarity: q.tunedRarity } : {}),
    ...(q.lock ? { lock: true } : {}),
  };
}

/** 一条 gunsmith 连同物化武器、货架库存、扣款和报价消耗，在 registry 的同一事务内生效 */
export function applyGunsmith(
  draft: Draft<InventoryState>,
  command: GunsmithCommand,
  world: WorldState,
  rawData: Readonly<Record<string, unknown>>,
  facts: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const quoted = quoteGunsmith(world, rawData, command);
  if (!quoted.ok) return quoted;
  const q = quoted.quote;
  if (q.blocked) return { ok: false, reason: q.blocked };
  const changed = checkNarratedPurchase(facts, gunsmithSettlement(q));
  if (changed) return { ok: false, reason: changed };

  const catalog = itemCatalog(withWorldObjects(rawData, draft.objects));
  const shop = shopList(withMerchants(rawData, draft.merchants)).find((s) => s.id === q.shop);
  if (!shop) return { ok: false, reason: `没有叫 ${q.shop} 的商店` };

  let targetId = command.weapon;
  let obj = draft.objects[targetId];
  const weaponDef = catalog.get(targetId) ?? obj?.definition;
  if (weaponDef?.kind !== "weapon" || weaponDef.category === undefined) {
    return { ok: false, reason: `没有武器 ${command.weapon}` };
  }

  if (!obj) {
    if (!takeFromBackpack(draft, targetId)) {
      return { ok: false, reason: `随身背包里没有${weaponDef.name}` };
    }
    const initialWs: WeaponInstanceState = defaultInstanceStateFromDef(weaponDef) ?? {
      baseId: weaponDef.id,
      mods: {},
      lockedSlots: [],
    };
    targetId = materializeWeapon(
      draft,
      weaponDef,
      initialWs,
      `由${weaponDef.name}经${q.shopName}改装`,
      q.label,
      world.time,
    );
    putToBackpack(draft, targetId);
    obj = draft.objects[targetId];
  }
  if (!obj) return { ok: false, reason: `无法物化武器 ${command.weapon}` };
  if (!obj.weaponState) {
    obj.weaponState = defaultInstanceStateFromDef(weaponDef) ?? {
      baseId: weaponDef.id,
      mods: {},
      lockedSlots: [],
    };
  }
  const ws = obj.weaponState;

  if (q.action === "install") {
    if (!q.mod || !q.slot || !q.source) {
      return { ok: false, reason: "安装指令缺少改装件或槽位信息" };
    }
    const modDef = catalog.get(q.mod);
    if (!modDef) return { ok: false, reason: `没有改装件 ${q.mod}` };
    if (q.source === "shelf") {
      const merchant = ensureMerchant(draft, shop, catalog, world.time);
      if ((merchant.stock[q.mod] ?? 0) < 1) {
        return { ok: false, reason: `${shop.name}没有${modDef.name}的现货` };
      }
      merchant.stock[q.mod] = (merchant.stock[q.mod] ?? 0) - 1;
      collectOrderedItem(draft, shop.id, q.mod);
      replenishAfterSale(
        draft,
        merchant.definition,
        modDef,
        world.time,
        LogisticsStateSchema.parse(world.slices.logistics ?? {}),
      );
    } else if (!takeFromBackpack(draft, q.mod)) {
      return { ok: false, reason: `背包里没有${modDef.name}` };
    }
    const oldMod = ws.mods[q.slot];
    if (oldMod !== undefined) putToBackpack(draft, oldMod);
    ws.mods[q.slot] = q.mod;
    if (q.lock && !ws.lockedSlots.includes(q.slot)) ws.lockedSlots.push(q.slot);
    obj.changedAt = world.time;
    obj.lastChange = `${q.shopName}：${q.replaces ? "换装" : "加装"} ${modDef.name}`;
  } else if (q.action === "detach") {
    if (!q.mod || !q.slot) {
      return { ok: false, reason: "拆装指令缺少改装件或槽位信息" };
    }
    Reflect.deleteProperty(ws.mods, q.slot);
    ws.lockedSlots = ws.lockedSlots.filter((s) => s !== q.slot);
    putToBackpack(draft, q.mod);
    obj.changedAt = world.time;
    obj.lastChange = `${q.shopName}：拆除并解锁 ${q.modName ?? q.mod}`;
    foldBackWeapon(draft, targetId);
  } else if (q.action === "tune") {
    if (!q.tunedRarity) return { ok: false, reason: "精调指令缺少目标品质" };
    ws.tunedRarity = q.tunedRarity;
    obj.changedAt = world.time;
    obj.lastChange = `${q.shopName}：精调至${RARITY_LABELS[q.tunedRarity]}`;
  } else {
    if (q.conversion === "smart-link") {
      ws.smartLink = true;
      obj.changedAt = world.time;
      obj.lastChange = `${q.shopName}：加装智能靶向联锁模块`;
    } else {
      if (!q.slot) return { ok: false, reason: "精工固锁指令缺少槽位" };
      if (!ws.lockedSlots.includes(q.slot)) ws.lockedSlots.push(q.slot);
      obj.changedAt = world.time;
      obj.lastChange = `${q.shopName}：精工固锁${MOD_SLOT_LABELS[q.slot]}`;
    }
  }

  const emit: Command[] = [];
  if (q.total > 0) {
    emit.push({
      type: "money",
      delta: -q.total,
      reason: `${q.shopName}：${q.label}，${command.reason}`,
    });
  }
  if (q.offer) emit.push({ type: "commerce.used", id: q.offer });

  return {
    ok: true,
    notes: [`${q.shopName}：${q.label}，${q.total} 欧元`],
    emit,
  };
}
