import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkNarratedPurchase } from "../commerce";
import type { Attribute } from "../dice";
import { quoteCyberware } from "./quote";
import {
  CyberwareCatalogSchema,
  type CyberwareCommand,
  type CyberwareDef,
  type CyberwareState,
  DEBT_DAYS,
  REPAIR_RATE,
  type Ripperdoc,
  type RipperdocDebtCommand,
  RipperdocListSchema,
  SLOT_CAPACITY,
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
  /** 原确认面板默认提出的替换候选（部位内最早装的）；未授权时不会自动拆卸 */
  readonly replaces: CyberwareDef | null;
}

export function ripperdocShelf(
  doc: Ripperdoc,
  catalog: ReadonlyMap<string, CyberwareDef>,
  installed: readonly { readonly id: string; readonly slot: string }[],
): ShelfItem[] {
  return doc.shelf.flatMap((id) => {
    const def = catalog.get(id);
    if (!def) return [];
    const locked = null;
    // 满位时为原确认面板选出候选；实际结算仍必须明确授权该旧件。
    const inSlot = installed.filter((c) => c.slot === def.slot && c.id !== id);
    const old = inSlot.length >= SLOT_CAPACITY[def.slot] ? inSlot[0] : undefined;
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
  readonly replace?: string | undefined;
}

/** 装上一件义体；满位必须明确指定替换目标，结算层不得自行出售旧件。 */
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
  const inSlot = draft.installed.filter((c) => c.slot === def.slot).length;
  const old = purchase?.replace
    ? draft.installed.findIndex((c) => c.id === purchase.replace && c.slot === def.slot)
    : -1;
  if (purchase?.replace && old < 0) return { ok: false, reason: "指定换下的义体没有装在这个部位" };
  if (inSlot >= SLOT_CAPACITY[def.slot] && old < 0) {
    return { ok: false, reason: "这个部位已装满，尚未授权替换具体义体" };
  }
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
  emit.push(bonusCommand(draft, catalog));
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
    emit: [bonusCommand(draft, catalog), { type: "health.limb", action: "clear", id }],
    signals: ["cyberware.changed"],
  };
}

/** 开启可用加速义体，只记录实际启动事件，不按使用次数收取资源 */
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
  draft.boost = { id, lastAt: now };
  return { ok: true, notes: [`开启${def.name}；持续使用的实际反应按设备、身体状态与现场条件记录`] };
}

/** 模型的 cyberware 指令 */
export function applyCyberware(
  draft: Draft<CyberwareState>,
  command: CyberwareCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的义体已经结算过` };
  }
  const world = {
    time: ctx.now,
    slices: {
      cyberware: draft,
      economy: ctx.read("economy"),
      health: ctx.read("health"),
      world: ctx.read("world"),
      npc: ctx.read("npc"),
      commerce: ctx.read("commerce"),
    },
  };
  const quoted = quoteCyberware(world, ctx.data, command);
  if (!quoted.ok) return quoted;
  const quote = quoted.quote;
  if (quote.blocked) return { ok: false, reason: quote.blocked };
  const changed = checkNarratedPurchase(ctx.facts, {
    seller: quote.doc,
    kind: "cyberware",
    action: command.action,
    target: quote.id ?? "repay",
    price: command.action === "remove" ? quote.receive : quote.total,
    cash: quote.cash,
    credit: quote.credit,
    creditAllowed: command.credit === true,
    replace: command.replace,
    tradeIn: command.tradeIn,
  });
  if (changed) return { ok: false, reason: changed };
  const catalog = cyberwareCatalog(ctx.data);
  let outcome: ApplyOutcome;
  if (command.action === "repay") {
    outcome = applyDebt(
      draft,
      { type: "cyberware.debt", action: "repay", doc: quote.doc, docName: quote.docName },
      ctx.now,
    );
  } else if (command.action === "install") {
    outcome = install(draft, quote.id as string, catalog, ctx.now, {
      price: 0,
      eddies: 0,
      replace: quote.replaces?.id,
    });
  } else if (command.action === "remove") {
    outcome = remove(draft, quote.id as string, catalog);
  } else {
    outcome = {
      ok: true,
      notes: [],
      emit: [{ type: "health.limb", action: "repair", id: quote.id, name: quote.name }],
    };
  }
  if (!outcome.ok) return outcome;
  const notes = [...(outcome.notes ?? [])];
  const emit: Command[] = [...(outcome.emit ?? [])];
  if (quote.credit > 0) {
    const debt = applyDebt(
      draft,
      {
        type: "cyberware.debt",
        action: "add",
        doc: quote.doc,
        docName: quote.docName,
        amount: quote.credit,
        item: quote.name,
      },
      ctx.now,
    );
    if (!debt.ok) return debt;
    notes.push(...(debt.notes ?? []));
    emit.push(...(debt.emit ?? []));
  }
  if (quote.cash > 0) {
    emit.push({
      type: "money",
      delta: -quote.cash,
      reason: `${quote.docName}：${quote.name}`,
    });
  }
  if (quote.receive > 0) {
    emit.push({
      type: "money",
      delta: quote.receive,
      reason: `${quote.docName}回收${quote.name}`,
    });
  }
  if (quote.offer) emit.push({ type: "commerce.used", id: quote.offer });
  if (quote.replaces) notes.push(`${quote.replaces.name}按已确认条件交给${quote.docName}`);
  if (command.event !== undefined) draft.settled.push(command.event);
  return { ...outcome, notes, emit };
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
