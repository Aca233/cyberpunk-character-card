import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkNarratedPurchase } from "../commerce";
import type { WorldClockState } from "../world";
import { quoteCyberware } from "./quote";
import {
  ARM_SIDE_LABELS,
  type ArmSide,
  CyberwareCatalogSchema,
  type CyberwareCommand,
  type CyberwareDef,
  type CyberwareState,
  checkCyberwareInstall,
  cyberwareConflicts,
  cyberwareExclusiveGroup,
  REPAIR_RATE,
  type Ripperdoc,
  type RipperdocDebtCommand,
  RipperdocListSchema,
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
  installed: readonly {
    readonly id: string;
    readonly slot: string;
    readonly armSide?: ArmSide | undefined;
  }[],
): ShelfItem[] {
  const installedProbes = installed.flatMap((c) => {
    const d = catalog.get(c.id);
    return d ? [c.armSide ? { ...d, armSide: c.armSide } : d] : [];
  });
  return doc.shelf.flatMap((id) => {
    const def = catalog.get(id);
    if (!def) return [];
    const alreadyInstalled = installed.some((c) => c.id === id);
    const conflict = cyberwareConflicts(def, installedProbes);
    const replaces = conflict.ok ? null : (conflict.blockers[0] ?? null);
    const check = alreadyInstalled
      ? { ok: true as const }
      : checkCyberwareInstall(def, installedProbes, {
          ignoreIds: replaces ? [replaces.id] : [],
        });
    const locked = check.ok ? null : check.reason;
    const price = Math.round((def.price * doc.priceFactor) / 100) * 100;
    const tradeIn = replaces ? Math.min(price, tradeInValue(replaces)) : 0;
    return [
      {
        def,
        price,
        tradeIn,
        net: price - tradeIn,
        locked,
        installed: alreadyInstalled,
        replaces,
      },
    ];
  });
}

export interface Purchase {
  readonly price: number;
  /** 身上现有的欧元 */
  readonly eddies: number;
  readonly event?: string | undefined;
  readonly replace?: string | undefined;
  readonly part?: string | undefined;
  readonly armSide?: ArmSide | undefined;
}

/** 装上一件义体；受物理互斥、分区空间上限与神经承载硬顶三道校验约束。 */
export function install(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
  purchase?: Purchase,
  explicitArmSide?: ArmSide,
): ApplyOutcome {
  const def = catalog.get(id);
  if (!def) return { ok: false, reason: `义体表里没有 ${id}` };
  const targetGroup = cyberwareExclusiveGroup(def);
  const armSide = targetGroup === "armMount" ? (explicitArmSide ?? purchase?.armSide) : undefined;
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
  const old = purchase?.replace
    ? draft.installed.findIndex((c) => {
        if (c.id !== purchase.replace) return false;
        const prevDef = catalog.get(c.id);
        const prevGroup = prevDef ? cyberwareExclusiveGroup(prevDef) : null;
        return (
          c.slot === def.slot ||
          (targetGroup !== null && prevGroup === targetGroup) ||
          (targetGroup === "capacityCore" &&
            (prevGroup === "cyberdeck" || prevGroup === "spineDrive")) ||
          ((targetGroup === "cyberdeck" || targetGroup === "spineDrive") &&
            prevGroup === "capacityCore")
        );
      })
    : -1;
  if (purchase?.replace && old < 0)
    return { ok: false, reason: "指定换下的义体与目标义体不在同一部位或互斥组" };
  const remainingProbes = draft.installed
    .filter((_, index) => index !== old)
    .flatMap((c) => {
      const d = catalog.get(c.id);
      return d ? [c.armSide ? { ...d, armSide: c.armSide } : d] : [];
    });
  const candidate = armSide ? { ...def, armSide } : def;
  const check = checkCyberwareInstall(candidate, remainingProbes);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }
  const emit: Command[] = [];
  if (old >= 0) {
    const [prev] = draft.installed.splice(old, 1);
    if (prev) {
      for (const part of Object.values(draft.parts)) {
        if (part.holder === "installed" && part.model === prev.id) part.holder = "player";
      }
      notes.push(`换下${catalog.get(prev.id)?.name ?? prev.id}`);
      const control = draft.behaviorChips?.[prev.id];
      if (control && control.mode !== "off") {
        control.mode = "off";
        control.protocol = null;
        control.carrier = null;
        control.since = now;
        if (control.lastControl && control.lastControl.to === null) control.lastControl.to = now;
      }
      emit.push({ type: "health.limb", action: "clear", id: prev.id });
    }
  }
  draft.installed.push({
    id,
    slot: def.slot,
    ...(armSide ? { armSide } : {}),
    installedAt: now,
  });
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
  const sideNote = armSide ? `（${ARM_SIDE_LABELS[armSide]}）` : "";
  notes.push(`${SLOT_LABELS[def.slot]}装上${def.name}${sideNote}`);
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
  return { ok: true, notes, emit, signals: ["cyberware.changed"] };
}

export function remove(
  draft: Draft<CyberwareState>,
  id: string,
  catalog: ReadonlyMap<string, CyberwareDef>,
  now: number,
): ApplyOutcome {
  const name = catalog.get(id)?.name ?? id;
  const i = draft.installed.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, reason: `没有装着${name}` };
  draft.installed.splice(i, 1);
  const control = draft.behaviorChips?.[id];
  if (control && control.mode !== "off") {
    control.mode = "off";
    control.protocol = null;
    control.carrier = null;
    control.since = now;
    if (control.lastControl && control.lastControl.to === null) control.lastControl.to = now;
  }
  for (const part of Object.values(draft.parts)) {
    if (part.holder === "installed" && part.model === id) part.holder = "player";
  }
  return {
    ok: true,
    notes: [`卸下${name}`],
    emit: [{ type: "health.limb", action: "clear", id }],
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
      ctx,
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
  ctx: SystemContext,
): ApplyOutcome {
  const now = ctx.now;
  if (command.action === "repay") {
    const debts = draft.debts.filter((d) => d.doc === command.doc);
    if (!debts.length) return { ok: false, reason: `不欠${command.docName}的钱` };
    draft.debts = draft.debts.filter((d) => d.doc !== command.doc);
    return {
      ok: true,
      notes: [`还清欠${command.docName}的 ${debts.reduce((sum, d) => sum + d.amount, 0)} 欧元`],
      emit: debts.flatMap((debt) => {
        const deadline = ctx
          .read<WorldClockState>("world")
          .deadlines.find((d) => d.id === debt.deadline);
        return deadline?.handledAt === null
          ? [{ type: "deadline", action: "handle", id: deadline.id }]
          : [];
      }),
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
