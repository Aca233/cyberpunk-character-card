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
  REPAIR_RATE,
  type Ripperdoc,
  type RipperdocDebtCommand,
  RipperdocListSchema,
  SLOT_CAPACITY,
  SLOT_LABELS,
  TRADE_IN_RATE,
} from "./schema";
import { beginService, cyberwareSettlement, finishService, serviceWorld } from "./service";

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
export function ripperdocList(
  data: Readonly<Record<string, unknown>>,
  state?: Pick<CyberwareState, "clinics">,
): readonly Ripperdoc[] {
  if (state) {
    const rows = new Map(ripperdocList(data).map((doc) => [doc.id, doc]));
    for (const clinic of Object.values(state.clinics))
      rows.set(clinic.definition.id, clinic.definition);
    return [...rows.values()];
  }
  const raw = data.ripperdocs;
  if (typeof raw !== "object" || raw === null) return [];
  const cached = doctorLists.get(raw);
  if (cached) return cached;
  const list = RipperdocListSchema.parse(raw);
  doctorLists.set(raw, list);
  return list;
}

/** 修好一件打坏的义体：参考价的三成，舍到百位，最少 100 */
export function repairCost(def: CyberwareDef): number {
  return Math.max(100, Math.round((def.price * REPAIR_RATE) / 100) * 100);
}

export function tradeInValue(def: CyberwareDef): number {
  return Math.floor((def.price * TRADE_IN_RATE) / 100) * 100;
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
  readonly part?: string | undefined;
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
      for (const part of Object.values(draft.parts)) {
        if (part.holder === "installed" && part.model === prev.id) part.holder = "player";
      }
      notes.push(`换下${catalog.get(prev.id)?.name ?? prev.id}`);
      emit.push({ type: "health.limb", action: "clear", id: prev.id });
    }
  }
  draft.installed.push({ id, slot: def.slot, installedAt: now });
  const physical = purchase?.part ? draft.parts[purchase.part] : undefined;
  if (physical) {
    physical.holder = "installed";
    physical.location = null;
  } else {
    const key = `body:${id}:${now}`;
    draft.parts[key] = {
      id: key,
      model: id,
      holder: "installed",
      location: null,
      condition: "intact",
      source: "初始已安装义体",
      at: now,
    };
  }
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
  for (const part of Object.values(draft.parts)) {
    if (part.holder === "installed" && part.model === id) part.holder = "player";
  }
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
  if (command.event !== undefined && draft.settled.includes(command.event))
    return { ok: false, reason: "这个义体交易事件已经结算过" };
  const result = quoteCyberware(serviceWorld(draft, ctx), ctx.data, command);
  if (!result.ok) return result;
  const q = result.quote;
  if (q.blocked) return { ok: false, reason: q.blocked };
  if (command.action === "repay") {
    const changed = checkNarratedPurchase(ctx.facts, cyberwareSettlement(q, command));
    if (changed) return { ok: false, reason: changed };
    const paid = applyDebt(
      draft,
      { type: "cyberware.debt", action: "repay", doc: q.doc, docName: q.docName },
      ctx.now,
    );
    if (!paid.ok) return paid;
    if (command.event) draft.settled.push(command.event);
    return {
      ...paid,
      emit: [...(paid.emit ?? []), { type: "money", delta: -q.cash, reason: "还清义体欠款" }],
    };
  }
  let sequence = 1;
  while (draft.services[`service:${q.doc}:${sequence}`]) sequence += 1;
  const id = `service:${q.doc}:${sequence}`;
  const begun = beginService(draft, command, q, ctx, id);
  if (!begun.ok) return begun;
  const done = command.action === "buy" ? { ok: true as const } : finishService(draft, id, ctx);
  if (!done.ok) return done;
  if (command.event) draft.settled.push(command.event);
  return {
    ...done,
    emit: [...(begun.emit ?? []), ...("emit" in done ? (done.emit ?? []) : [])],
    notes: [...(begun.notes ?? []), ...("notes" in done ? (done.notes ?? []) : [])],
  };
}

/** 赊账和还钱：赊账记一条期限，还清时把期限标成办完 */
export function applyDebt(
  draft: Draft<CyberwareState>,
  command: RipperdocDebtCommand,
  now: number,
): ApplyOutcome {
  if (command.action === "repay") {
    const debts = draft.debts.filter((d) => d.doc === command.doc);
    if (!debts.length) return { ok: false, reason: `不欠${command.docName}的钱` };
    draft.debts = draft.debts.filter((d) => d.doc !== command.doc);
    return {
      ok: true,
      notes: [`还清欠${command.docName}的 ${debts.reduce((sum, d) => sum + d.amount, 0)} 欧元`],
      emit: debts.flatMap((debt) =>
        debt.deadline ? [{ type: "deadline", action: "handle", id: debt.deadline }] : [],
      ),
    };
  }
  if (command.amount === undefined) return { ok: false, reason: "赊账要写金额" };
  const due = command.due ?? null;
  const deadline =
    due === null ? null : `ripperdoc-debt-${command.doc}-${now}-${draft.debts.length + 1}`;
  draft.debts.push({
    doc: command.doc,
    docName: command.docName,
    amount: command.amount,
    due,
    deadline,
  });
  return {
    ok: true,
    notes: [
      `向${command.docName}赊了 ${command.amount} 欧元${due === null ? "，未约定还款期限" : `，于游戏分钟 ${due} 前归还`}`,
    ],
    emit:
      due === null
        ? []
        : [
            {
              type: "deadline",
              action: "add",
              id: deadline,
              label: `还${command.docName} ${command.amount} 欧元${command.item ? `（${command.item}的尾款）` : ""}`,
              due,
            },
          ],
  };
}
