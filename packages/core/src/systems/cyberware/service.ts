import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { checkNarratedPurchase, type NarratedPurchase, tradeEvidence } from "../commerce";
import type { HealthState } from "../health";
import { merchantAt, type WorldClockState } from "../world";
import { applyDebt, cyberwareCatalog, install, remove, ripperdocList } from "./apply";
import { type CyberwareQuote, clinicProvider, DoctorRosterSchema, quoteCyberware } from "./quote";
import {
  type CyberwareCommand,
  type CyberwareService,
  type CyberwareState,
  CyberwareStateSchema,
  type CyberwareTerms,
  CyberwareTermsSchema,
} from "./schema";
import { clinicState, ensureClinic, partId } from "./stock";
import type { ServiceCommand } from "./workshop-schema";

export function cyberwareSettlement(q: CyberwareQuote, terms: CyberwareTerms): NarratedPurchase {
  return {
    seller: q.doc,
    kind: "cyberware",
    action: q.action,
    target: q.id ?? "repay",
    price: q.action === "remove" && q.disposition === "sell" ? q.receive : q.total,
    cash: q.cash,
    credit: q.credit,
    creditAllowed: terms.credit === true,
    replace: terms.replace,
    tradeIn: q.disposition === "sell",
    part: q.part ?? undefined,
    disposition: q.disposition ?? undefined,
    startsAt: q.startsAt,
    endsAt: q.endsAt,
    provider: q.providerId,
    stockRevision: q.stockRevision,
    debtDue: q.credit > 0 ? q.debtDue : undefined,
  };
}

export function serviceWorld(draft: Draft<CyberwareState>, ctx: SystemContext) {
  return {
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
}

function bodyPart(draft: Draft<CyberwareState>, model: string, ctx: SystemContext) {
  const found = Object.values(draft.parts).find(
    (p) => p.model === model && p.holder === "installed",
  );
  if (found) {
    if (ctx.read<HealthState>("health").brokenChrome.includes(model)) found.condition = "damaged";
    return found;
  }
  const original = draft.installed.find((p) => p.id === model);
  if (!original) throw new Error("拆卸缺少实际已装义体");
  const id = `body:${model}:${original.installedAt}`;
  draft.parts[id] = {
    id,
    model,
    holder: "installed",
    location: null,
    condition: ctx.read<HealthState>("health").brokenChrome.includes(model) ? "damaged" : "intact",
    source: "身体原有义体",
    at: original.installedAt,
  };
  return draft.parts[id];
}

function acquire(draft: Draft<CyberwareState>, q: CyberwareQuote, ctx: SystemContext): string {
  if (q.part) return q.part;
  const doc = ripperdocList(ctx.data).find((d) => d.id === q.doc);
  if (!doc || !q.id) throw new Error("已确认报价缺少诊所或型号");
  const clinic = ensureClinic(draft, doc, ctx.now);
  const existing = Object.values(draft.parts).find(
    (p) =>
      p.model === q.id &&
      p.holder === q.doc &&
      p.condition === "intact" &&
      (p.location === null || merchantAt(ctx.data, doc.id, doc.location, p.location)),
  );
  if (existing) {
    existing.holder = "player";
    existing.location = null;
    clinic.revision += 1;
    return existing.id;
  }
  clinic.stock[q.id] = (clinic.stock[q.id] ?? 0) - 1;
  clinic.revision += 1;
  const id = partId(draft, q.id);
  draft.parts[id] = {
    id,
    model: q.id,
    holder: "player",
    location: null,
    condition: "intact",
    source: `${q.docName}已交付现货`,
    at: ctx.now,
  };
  return id;
}

export function beginService(
  draft: Draft<CyberwareState>,
  command: CyberwareCommand,
  q: CyberwareQuote,
  ctx: SystemContext,
  id: string,
  authorized?: NarratedPurchase,
): ApplyOutcome {
  const changed = checkNarratedPurchase(ctx.facts, authorized ?? cyberwareSettlement(q, command));
  if (changed) return { ok: false, reason: changed };
  const expected = ctx.facts.tradeQuote as NarratedPurchase | undefined;
  if (q.startsAt < ctx.now && expected?.startsAt !== q.startsAt)
    return { ok: false, reason: "不能未经本轮确认倒填手术开始时间" };
  if (q.startsAt > ctx.now) return { ok: false, reason: "预约尚未到开始时间" };
  const emit: Command[] = [];
  const notes: string[] = [];
  const doc = ripperdocList(ctx.data).find((d) => d.id === q.doc);
  if (!doc) return { ok: false, reason: "已确认诊所已不存在" };
  const clinic = ensureClinic(draft, doc, ctx.now);
  let physical: string | null = null;
  let oldPart: string | null = null;
  if (command.action === "buy" || command.action === "install") physical = acquire(draft, q, ctx);
  else if (command.action === "repair" && command.part) physical = command.part;
  if (q.replaces || command.action === "remove") {
    const model = q.replaces?.id ?? q.id;
    if (!model) return { ok: false, reason: "缺少实际拆卸型号" };
    const old = bodyPart(draft, model, ctx);
    oldPart = old.id;
    const result = remove(draft, model, cyberwareCatalog(ctx.data));
    if (!result.ok) return result;
    emit.push(...(result.emit ?? []));
    notes.push(...(result.notes ?? []));
    old.holder =
      q.disposition === "sell" ? q.doc : q.disposition === "scrap" ? "scrapped" : `service:${id}`;
    old.location = doc.location;
    if (q.disposition === "scrap") old.condition = "scrapped";
    if (q.disposition === "sell") clinic.revision += 1;
  }
  if (physical && command.action !== "buy") {
    const object = draft.parts[physical];
    if (!object) return { ok: false, reason: "交付实物不存在" };
    object.holder = `service:${id}`;
    object.location = doc.location;
  }
  if (q.credit > 0) {
    const outcome = applyDebt(
      draft,
      {
        type: "cyberware.debt",
        action: "add",
        doc: q.doc,
        docName: q.docName,
        amount: q.credit,
        item: q.name,
        due: q.debtDue,
      },
      ctx.now,
    );
    if (!outcome.ok) return outcome;
    emit.push(...(outcome.emit ?? []));
    notes.push(...(outcome.notes ?? []));
  }
  if (q.cash) emit.push({ type: "money", delta: -q.cash, reason: `${q.docName}：${q.name}` });
  if (q.receive)
    emit.push({ type: "money", delta: q.receive, reason: `${q.docName}回收${q.name}` });
  if (q.offer) emit.push({ type: "commerce.used", id: q.offer });
  if (command.action !== "buy")
    draft.services[id] = {
      id,
      terms: CyberwareTermsSchema.parse({
        ...command,
        startAt: q.startsAt,
        offer: q.offer ?? undefined,
      }),
      provider: q.providerId,
      providerName: q.provider,
      scheduledAt: q.startsAt,
      startedAt: q.startsAt,
      endsAt: q.endsAt,
      remaining: q.endsAt - q.startsAt,
      status: "active",
      price: q.total,
      cash: q.cash,
      credit: q.credit,
      receive: q.receive,
      part: physical,
      oldPart,
      reason: command.reason,
    };
  return { ok: true, emit, notes };
}

function providerReady(
  service: CyberwareService,
  draft: Draft<CyberwareState>,
  ctx: SystemContext,
): string | undefined {
  const doc = ripperdocList(ctx.data).find((d) => d.id === service.terms.doc);
  if (!doc) return "诊所已不存在";
  const clinic = clinicState(draft, doc, ctx.now);
  if (!clinic.open || !clinic.equipment.includes("surgery")) return "诊所或手术设备当前不可用";
  if (!merchantAt(ctx.data, doc.id, doc.location, ctx.read<WorldClockState>("world").location))
    return "玩家不在提供手术的诊所";
  if (service.provider !== doc.id && !clinic.staff.includes(service.provider))
    return "原定医生已不在服务名单中";
  const provider = clinicProvider(
    doc,
    DoctorRosterSchema.parse(ctx.read("npc")).npcs,
    [service.provider],
    ctx.data,
  );
  return provider.ok ? undefined : provider.reason;
}

export function finishService(
  draft: Draft<CyberwareState>,
  id: string,
  ctx: SystemContext,
): ApplyOutcome {
  const service = draft.services[id];
  if (service?.status !== "active")
    return { ok: false, reason: "服务未在进行中，不能重复或越过中断直接完成" };
  const unavailable = providerReady(service, draft, ctx);
  if (unavailable) return { ok: false, reason: unavailable };
  const emit: Command[] = [];
  if (service.terms.action === "install") {
    const physical = service.part ? draft.parts[service.part] : undefined;
    if (!physical || physical.holder !== `service:${id}`)
      return { ok: false, reason: "手术所需实物已不在当前订单中" };
    const result = install(draft, physical.model, cyberwareCatalog(ctx.data), service.endsAt, {
      price: 0,
      eddies: 0,
      part: physical.id,
    });
    if (!result.ok) return result;
    emit.push(...(result.emit ?? []));
  } else if (service.terms.action === "repair") {
    if (service.part) {
      const physical = draft.parts[service.part];
      if (!physical || physical.holder !== `service:${id}`)
        return { ok: false, reason: "维修中的实物已不在本订单内" };
      physical.condition = "intact";
      physical.holder = "player";
      physical.location = null;
    } else
      emit.push({
        type: "health.limb",
        action: "repair",
        id: service.terms.id,
        name: cyberwareCatalog(ctx.data).get(service.terms.id ?? "")?.name ?? service.terms.id,
      });
  }
  const old = service.oldPart ? draft.parts[service.oldPart] : undefined;
  if (old?.holder === `service:${id}`) {
    old.holder = "player";
    old.location = null;
  }
  service.status = "completed";
  service.remaining = 0;
  return {
    ok: true,
    emit,
    notes: [`${service.providerName}完成服务；开始 ${service.startedAt}，结束 ${service.endsAt}`],
    advanceTo: Math.max(ctx.now, service.endsAt),
    signals: ["cyberware.changed"],
  };
}

export type ServiceIntent = Pick<
  ServiceCommand,
  "action" | "id" | "request" | "scheduledAt" | "startAt"
>;

/** 预约与服务状态变化共用的只读授权事实；开始才扣钱，完成沿用原截止时刻。 */
export function quoteCyberwareService(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  command: ServiceIntent,
):
  | {
      ok: true;
      settlement: NarratedPurchase;
      price: number;
      detail: string;
      quote?: CyberwareQuote;
    }
  | { ok: false; reason: string } {
  const state = CyberwareStateSchema.parse(world.slices.cyberware);
  const service = state.services[command.id];
  if (command.action === "book" || command.action === "start") {
    if (
      command.action === "book"
        ? service !== undefined || !command.request
        : service?.status !== "booked"
    )
      return { ok: false, reason: "预约需新订单，开始需已有未开始订单" };
    const terms = command.action === "book" ? command.request : service?.terms;
    if (!terms || !["install", "remove", "repair"].includes(terms.action))
      return { ok: false, reason: "预约必须对应具体义体手术" };
    const startAt =
      command.action === "book"
        ? (command.scheduledAt ?? world.time)
        : (command.startAt ?? world.time);
    if (
      (command.action === "book" && startAt < world.time) ||
      (service && startAt < service.scheduledAt)
    )
      return { ok: false, reason: "尚未到约定开始时间" };
    const result = quoteCyberware(
      world,
      data,
      { ...terms, startAt },
      { ...(service ? { service: service.id } : {}), checkFunds: command.action === "start" },
    );
    if (!result.ok) return result;
    const q = result.quote;
    if (q.blocked) return { ok: false, reason: q.blocked };
    if (
      service &&
      (q.total !== service.price ||
        q.receive !== service.receive ||
        q.providerId !== service.provider)
    )
      return { ok: false, reason: "预约价格或医生发生变化，须重新确认" };
    const actual = cyberwareSettlement(q, terms);
    const settlement = {
      ...actual,
      action: `service:${command.action}`,
      serviceOrder: command.id,
      cash: command.action === "start" ? q.cash : 0,
      credit: command.action === "start" ? q.credit : 0,
    };
    return {
      ok: true,
      settlement,
      quote: q,
      price: command.action === "start" ? q.cash : 0,
      detail: `${q.provider} ${command.action === "book" ? "预约" : "开始"}${q.name}；起止 ${q.startsAt}—${q.endsAt}；服务总对价 ${q.total}，本次现金 ${settlement.cash}，借款 ${settlement.credit}；订单 ${command.id}`,
    };
  }
  if (!service) return { ok: false, reason: "服务订单不存在" };
  if (command.action === "complete" && service.status !== "active")
    return { ok: false, reason: "只有进行中的服务可以完成" };
  if (command.action === "resume" && service.status !== "interrupted")
    return { ok: false, reason: "只有中断服务可以继续" };
  if (["cancelled", "completed"].includes(service.status))
    return { ok: false, reason: "服务订单已结束" };
  const startsAt =
    command.action === "resume"
      ? (command.startAt ?? world.time)
      : (service.startedAt ?? service.scheduledAt);
  const endsAt = command.action === "resume" ? startsAt + service.remaining : service.endsAt;
  const settlement: NarratedPurchase = {
    seller: service.terms.doc,
    kind: "cyberware",
    action: `service:${command.action}`,
    target: service.terms.id ?? "",
    price: 0,
    cash: 0,
    credit: 0,
    creditAllowed: false,
    serviceOrder: service.id,
    part: service.part ?? undefined,
    replace: service.terms.replace,
    disposition: service.terms.disposition ?? (service.terms.tradeIn ? "sell" : undefined),
    tradeIn: service.terms.disposition === "sell" || service.terms.tradeIn === true,
    startsAt,
    endsAt,
    provider: service.provider,
  };
  return {
    ok: true,
    settlement,
    price: 0,
    detail: `服务订单 ${service.id}：${command.action}，原已付现金 ${service.cash}；本次不重复收费；起止 ${startsAt}—${endsAt}，已拆旧件和手术实物保持记录`,
  };
}

export function applyService(
  draft: Draft<CyberwareState>,
  command: ServiceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (!tradeEvidence(ctx.facts, command.evidence))
    return { ok: false, reason: "服务变更缺少本轮正文证据" };
  const authorization =
    command.action === "interrupt"
      ? undefined
      : quoteCyberwareService(serviceWorld(draft, ctx), ctx.data, command);
  if (authorization && !authorization.ok) return authorization;
  if (authorization?.ok) {
    const changed = checkNarratedPurchase(ctx.facts, authorization.settlement);
    if (changed) return { ok: false, reason: changed };
    const expected = ctx.facts.tradeQuote as NarratedPurchase | undefined;
    if (
      (command.action === "start" || command.action === "resume") &&
      (authorization.settlement.startsAt ?? ctx.now) < ctx.now &&
      expected?.startsAt !== authorization.settlement.startsAt
    )
      return { ok: false, reason: "不能未经本轮授权倒填服务开始时间" };
  }
  const existing = draft.services[command.id];
  if (command.action === "book") {
    if (
      existing ||
      !command.request ||
      !["install", "remove", "repair"].includes(command.request.action)
    )
      return { ok: false, reason: "预约需新的服务 id 和具体手术内容" };
    const startAt = command.scheduledAt ?? ctx.now;
    if (startAt < ctx.now) return { ok: false, reason: "预约不能早于当前时间" };
    const request = { ...command.request, startAt };
    const result = quoteCyberware(serviceWorld(draft, ctx), ctx.data, request, {
      checkFunds: false,
    });
    if (!result.ok) return result;
    const q = result.quote;
    draft.services[command.id] = {
      id: command.id,
      terms: request,
      provider: q.providerId,
      providerName: q.provider,
      scheduledAt: startAt,
      startedAt: null,
      endsAt: q.endsAt,
      remaining: q.endsAt - q.startsAt,
      status: "booked",
      price: q.total,
      cash: q.cash,
      credit: q.credit,
      receive: q.receive,
      part: q.part,
      oldPart: null,
      reason: command.reason,
    };
    return { ok: true, notes: ["已预约具体医生和时段；尚未付款或移动实物"] };
  }
  if (!existing) return { ok: false, reason: "服务订单不存在" };
  if (command.action === "start") {
    if (existing.status !== "booked" || ctx.now < existing.scheduledAt)
      return { ok: false, reason: "预约尚未到时间或已经开始" };
    const request = { ...existing.terms, startAt: command.startAt ?? ctx.now };
    const result = quoteCyberware(serviceWorld(draft, ctx), ctx.data, request, {
      service: command.id,
    });
    if (!result.ok) return result;
    if (result.quote.blocked) return { ok: false, reason: result.quote.blocked };
    if (
      result.quote.total !== existing.price ||
      result.quote.receive !== existing.receive ||
      result.quote.providerId !== existing.provider
    )
      return { ok: false, reason: "预约价格或医生变化，需要重新确认" };
    return beginService(
      draft,
      { type: "cyberware", ...request, reason: command.reason },
      result.quote,
      ctx,
      command.id,
      authorization?.ok ? authorization.settlement : undefined,
    );
  }
  if (command.action === "complete") return finishService(draft, command.id, ctx);
  if (command.action === "interrupt") {
    if (existing.status !== "active") return { ok: false, reason: "只有正在进行的手术才能中断" };
    existing.remaining = Math.max(1, existing.endsAt - ctx.now);
    existing.status = "interrupted";
    existing.reason = command.reason;
    return { ok: true, notes: ["手术已中断，已付款项、拆下旧件和在场实物保持实际状态"] };
  }
  if (command.action === "resume") {
    if (existing.status !== "interrupted") return { ok: false, reason: "只有已中断的手术才能继续" };
    const unavailable = providerReady(existing, draft, ctx);
    if (unavailable) return { ok: false, reason: unavailable };
    if ((command.startAt ?? ctx.now) > ctx.now)
      return { ok: false, reason: "尚未到继续手术的开始时刻" };
    const competing = Object.values(draft.services).some(
      (s) =>
        s.id !== existing.id &&
        s.provider === existing.provider &&
        ["active", "booked"].includes(s.status) &&
        s.scheduledAt < ctx.now + existing.remaining &&
        s.endsAt > ctx.now,
    );
    if (competing) return { ok: false, reason: "医生剩余时段与已有预约冲突" };
    if (existing.part && draft.parts[existing.part]?.holder !== `service:${existing.id}`)
      return { ok: false, reason: "服务实物已移出，不能直接继续" };
    existing.endsAt = (command.startAt ?? ctx.now) + existing.remaining;
    existing.status = "active";
    return { ok: true, notes: ["按剩余服务时间继续，不重复收款"] };
  }
  if (["cancelled", "completed"].includes(existing.status))
    return { ok: false, reason: "订单已经结束" };
  existing.status = "cancelled";
  existing.reason = command.reason;
  return {
    ok: true,
    notes: ["订单取消；未开始预约无款项和实物变动，已开始手术保留已执行阶段，取回寄存件需实际转交"],
  };
}
