import type { Draft } from "immer";
import type { ApplyOutcome, Command } from "../../kernel/system";
import type { Attribute } from "../dice";
import { type Keeper, rarityLock } from "../economy";
import { HUMANITY_MAX } from "../humanity";
import {
  BOOST_WINDOW,
  CyberwareCatalogSchema,
  type CyberwareCommand,
  type CyberwareDef,
  type CyberwareState,
  DEBT_DAYS,
  REPAIR_RATE,
  type Ripperdoc,
  type RipperdocDebtCommand,
  RipperdocListSchema,
  SLOT_LABELS,
  TRADE_IN_RATE,
} from "./schema";

const catalogs = new WeakMap<object, ReadonlyMap<string, CyberwareDef>>();

/** 读取并校验义体表；没有义体表时是空表 */
export function cyberwareCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, CyberwareDef> {
  const raw = data.cyberware;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map<string, CyberwareDef>();
  for (const part of CyberwareCatalogSchema.parse(raw)) {
    if (catalog.has(part.id)) throw new Error(`义体表里的 id 重复：${part.id}`);
    catalog.set(part.id, part);
  }
  catalogs.set(raw, catalog);
  return catalog;
}

const doctorLists = new WeakMap<object, readonly Ripperdoc[]>();

/** 读取并校验义体医生表；没有时是空表 */
export function ripperdocList(data: Readonly<Record<string, unknown>>): readonly Ripperdoc[] {
  const raw = data.ripperdocs;
  if (typeof raw !== "object" || raw === null) return [];
  const cached = doctorLists.get(raw);
  if (cached) return cached;
  const list = RipperdocListSchema.parse(raw);
  doctorLists.set(raw, list);
  return list;
}

/** 医生回收一件旧义体给多少：参考价的两成，舍到百位；不朽义体不回收 */
/** 修好一件打坏的义体：参考价的三成，舍到百位，最少 100 */
export function repairCost(def: CyberwareDef): number {
  return Math.max(100, Math.round((def.price * REPAIR_RATE) / 100) * 100);
}

export function tradeInValue(def: CyberwareDef): number {
  return def.iconic ? 0 : Math.floor((def.price * TRADE_IN_RATE) / 100) * 100;
}

/** 货架上的一件：价格按医生的系数折算到百位；locked 是不卖的原因 */
export interface ShelfItem {
  readonly def: CyberwareDef;
  readonly price: number;
  /** 换下的旧件抵掉多少 */
  readonly tradeIn: number;
  /** 抵完旧件实际要付的 */
  readonly net: number;
  readonly locked: string | null;
  readonly installed: boolean;
  /** 同一部位已经装着、装上会换下来的那件 */
  readonly replaces: CyberwareDef | null;
}

export function ripperdocShelf(
  doc: Ripperdoc,
  catalog: ReadonlyMap<string, CyberwareDef>,
  streetCred: number,
  installed: readonly { readonly id: string; readonly slot: string }[],
  /** 医生有人物卡、见过面时传：好感够了，没到声望门槛的货也肯卖 */
  keeper?: Keeper,
): ShelfItem[] {
  return doc.shelf.flatMap((id) => {
    const def = catalog.get(id);
    if (!def) return [];
    const locked = def.iconic
      ? "不朽义体只从剧情获得"
      : rarityLock(def.rarity, doc.credGates, streetCred, keeper);
    const old = installed.find((c) => c.slot === def.slot && c.id !== id);
    const replaces = old ? (catalog.get(old.id) ?? null) : null;
    const price = Math.round((def.price * doc.priceFactor) / 100) * 100;
    const tradeIn = replaces ? Math.min(price, tradeInValue(replaces)) : 0;
    return [
      {
        def,
        price,
        tradeIn,
        net: price - tradeIn,
        locked,
        installed: installed.some((c) => c.id === id),
        replaces,
      },
    ];
  });
}

/** 装着的义体一共占掉多少人性上限 */
function costCommand(
  draft: Draft<CyberwareState>,
  catalog: ReadonlyMap<string, CyberwareDef>,
): Command {
  const total = draft.installed.reduce((sum, c) => sum + (catalog.get(c.id)?.humanityCost ?? 0), 0);
  return { type: "humanity.setCyberwareCost", total: Math.min(HUMANITY_MAX, total) };
}

/** 装着的义体一共给哪些属性加多少 */
function bonusCommand(
  draft: Draft<CyberwareState>,
  catalog: ReadonlyMap<string, CyberwareDef>,
): Command {
  const bonuses: Partial<Record<Attribute, number>> = {};
  for (const c of draft.installed) {
    for (const [a, n] of Object.entries(catalog.get(c.id)?.attributes ?? {}) as [
      Attribute,
      number,
    ][]) {
      bonuses[a] = (bonuses[a] ?? 0) + n;
    }
  }
  return { type: "character.setBonuses", bonuses };
}

export interface Purchase {
  readonly price: number;
  /** 身上现有的欧元 */
  readonly eddies: number;
  readonly event?: string | undefined;
}

/** 装上一件义体：同一部位的旧件换下来；买的要先付得起，钱交给欧元系统扣 */
export function install(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  purchase?: Purchase,
): ApplyOutcome {
  const def = catalog.get(id);
  if (!def) return { ok: false, reason: `义体表里没有 ${id}` };
  if (draft.installed.some((c) => c.id === id)) {
    return { ok: false, reason: `${def.name}已经装着了` };
  }
  if (purchase && purchase.price > purchase.eddies) {
    return {
      ok: false,
      reason: `欧元不够：${def.name}要 ${purchase.price}，身上只有 ${purchase.eddies}`,
    };
  }
  const notes: string[] = [];
  const old = draft.installed.findIndex((c) => c.slot === def.slot);
  const emit: Command[] = [];
  if (old >= 0) {
    const [prev] = draft.installed.splice(old, 1);
    if (prev) {
      notes.push(`换下${catalog.get(prev.id)?.name ?? prev.id}`);
      emit.push({ type: "health.limb", action: "clear", id: prev.id });
    }
  }
  draft.installed.push({ id, slot: def.slot, installedAt: now });
  notes.push(`${SLOT_LABELS[def.slot]}装上${def.name}`);
  if (def.slot === "arms" || def.slot === "legs") {
    emit.push({ type: "health.limb", action: "fit", slot: def.slot, name: def.name });
  }
  if (purchase && purchase.price > 0) {
    emit.push({
      type: "money",
      delta: -purchase.price,
      reason: `安装义体：${def.name}`,
      ...(purchase.event ? { event: purchase.event } : {}),
    });
  }
  emit.push(costCommand(draft, catalog), bonusCommand(draft, catalog));
  return { ok: true, notes, emit, signals: ["cyberware.changed"] };
}

export function remove(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
): ApplyOutcome {
  const name = catalog.get(id)?.name ?? id;
  const i = draft.installed.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, reason: `没有装着${name}` };
  draft.installed.splice(i, 1);
  return {
    ok: true,
    notes: [`卸下${name}`],
    emit: [
      costCommand(draft, catalog),
      bonusCommand(draft, catalog),
      { type: "health.limb", action: "clear", id },
    ],
    signals: ["cyberware.changed"],
  };
}

/** 生死瞬间开加速义体：上一次开过后一小时内再开算连续使用，人性代价按连续次数递增 */
export function applyBoost(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  broken: readonly string[],
): ApplyOutcome {
  const def = catalog.get(id);
  if (!def?.accelerator) return { ok: false, reason: `${def?.name ?? id}不是加速义体` };
  if (!draft.installed.some((c) => c.id === id))
    return { ok: false, reason: `没有装着${def.name}` };
  if (broken.includes(id)) return { ok: false, reason: `${def.name}打坏了，修好前开不了` };
  const last = draft.boost;
  const count = last && now - last.lastAt <= BOOST_WINDOW ? last.count + 1 : 1;
  draft.boost = { count, lastAt: now };
  return {
    ok: true,
    notes: [`开了${def.name}${count > 1 ? `（连续第 ${count} 次）` : ""}`],
    emit: [{ type: "humanity", delta: -count, reason: `开${def.name}` }],
  };
}

/** 模型的 cyberware 指令 */
export function applyCyberware(
  draft: Draft<CyberwareState>,
  command: CyberwareCommand,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  eddies: number,
): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的义体已经结算过` };
  }
  const outcome =
    command.action === "install"
      ? install(draft, command.id, catalog, now, {
          price: command.price ?? catalog.get(command.id)?.price ?? 0,
          eddies,
          event: command.event && `cyberware:${command.event}`,
        })
      : remove(draft, command.id, catalog);
  if (outcome.ok && command.event !== undefined) draft.settled.push(command.event);
  return outcome;
}

/** 赊账和还钱：赊账记一条期限，还清时把期限标成办完 */
export function applyDebt(
  draft: Draft<CyberwareState>,
  command: RipperdocDebtCommand,
  now: number,
): ApplyOutcome {
  const i = draft.debts.findIndex((d) => d.doc === command.doc);
  if (command.action === "repay") {
    const debt = draft.debts[i];
    if (!debt) return { ok: false, reason: `不欠${command.docName}的钱` };
    draft.debts.splice(i, 1);
    return {
      ok: true,
      notes: [`还清欠${debt.docName}的 ${debt.amount} 欧元`],
      emit: [{ type: "deadline", action: "handle", id: debt.deadline }],
    };
  }
  if (i >= 0) return { ok: false, reason: `还欠着${command.docName}的钱，先还清` };
  if (command.amount === undefined) return { ok: false, reason: "赊账要写金额" };
  const due = now + DEBT_DAYS * 24 * 60;
  const deadline = `ripperdoc-debt-${command.doc}-${now}`;
  draft.debts.push({
    doc: command.doc,
    docName: command.docName,
    amount: command.amount,
    due,
    deadline,
  });
  return {
    ok: true,
    notes: [`向${command.docName}赊了 ${command.amount} 欧元，${DEBT_DAYS} 天内还清`],
    emit: [
      {
        type: "deadline",
        action: "add",
        id: deadline,
        label: `还${command.docName} ${command.amount} 欧元${command.item ? `（${command.item}的尾款）` : ""}，到期不还他会找上门`,
        due,
      },
    ],
  };
}
