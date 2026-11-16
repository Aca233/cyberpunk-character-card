import { z } from "zod";
import type { WorldState } from "../../kernel/world";
import { agreedQuote } from "../commerce";
import { EconomyStateSchema, MONEY_CAP } from "../economy";
import { HealthStateSchema } from "../health";
import { merchantAt, WorldClockStateSchema } from "../world";
import { cyberwareCatalog, repairCost, ripperdocList, tradeInValue } from "./apply";
import { CyberwareStateSchema, type CyberwareTerms, type Ripperdoc, SLOT_CAPACITY } from "./schema";
import { actualStock, clinicState } from "./stock";

export const DoctorRosterSchema = z.object({
  npcs: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        alive: z.boolean(),
        location: z.string().nullable().optional(),
        affinity: z.number().default(0),
        met: z.boolean().default(false),
      }),
    )
    .default({}),
});

/** 未登记位置不等于离场；其他已登记服务医生可以接诊。 */
export function clinicProvider(
  doc: Ripperdoc,
  roster: z.infer<typeof DoctorRosterSchema>["npcs"],
  ids: readonly string[] = [...(doc.keeperNpc ? [doc.keeperNpc] : []), ...doc.serviceNpcs],
  data: Readonly<Record<string, unknown>> = {},
):
  | { readonly ok: true; readonly id: string; readonly name: string }
  | { readonly ok: false; readonly reason: string } {
  if (ids.length === 0) return { ok: false, reason: "诊所当前没有已登记服务人员" };
  for (const id of ids) {
    const person = roster[id];
    if (!person)
      return { ok: true, id, name: id === doc.keeperNpc || id === doc.id ? doc.name : id };
    if (
      person.alive &&
      (person.location == null || merchantAt(data, doc.id, doc.location, person.location))
    ) {
      return { ok: true, id, name: person.name };
    }
  }
  return { ok: false, reason: `${doc.name}的诊所当前没有已登记的在场医生可以提供服务` };
}

export type CyberwareQuoteRequest = CyberwareTerms;

export interface CyberwareQuote {
  readonly action: CyberwareQuoteRequest["action"];
  readonly doc: string;
  readonly docName: string;
  readonly provider: string;
  readonly providerId: string;
  readonly part: string | null;
  readonly disposition: "keep" | "sell" | "scrap" | null;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly stockRevision: number;
  readonly debtDue: number | null;
  readonly id?: string | undefined;
  readonly name: string;
  /** 面板展示的折抵前金额；减去 tradeIn 等于本次实际应付 total。 */
  readonly price: number;
  readonly tradeIn: number;
  /** 本次应付净价；拆卸回收时为 0，回收所得见 receive。 */
  readonly total: number;
  readonly cash: number;
  readonly credit: number;
  readonly receive: number;
  readonly replaces: { readonly id: string; readonly name: string } | null;
  readonly offer: string | null;
  /** 报价可以展示，但余额或赊账条件不满足时不可成交。 */
  readonly blocked: string | null;
}

export type CyberwareQuoteResult =
  | { readonly ok: true; readonly quote: CyberwareQuote }
  | { readonly ok: false; readonly reason: string };

/** 只读报价：面板、按钮、判断与实际成交共用，不扣款、不借款、不消费报价。 */
export function quoteCyberware(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
  request: CyberwareQuoteRequest,
  options: { service?: string; checkFunds?: boolean } = {},
): CyberwareQuoteResult {
  const state = CyberwareStateSchema.parse(world.slices.cyberware);
  const doc = ripperdocList(data, state).find((d) => d.id === request.doc);
  if (!doc) return { ok: false, reason: `没有叫 ${request.doc} 的义体医生` };
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  if (!merchantAt(data, doc.id, doc.location, location))
    return { ok: false, reason: `不在${doc.name}的诊所，先去那里` };
  const clinic = clinicState(state, doc, world.time);
  if (!clinic.open) return { ok: false, reason: `诊所暂停服务：${clinic.reason}` };
  const provider = clinicProvider(
    doc,
    DoctorRosterSchema.parse(world.slices.npc ?? {}).npcs,
    clinic.staff,
    data,
  );
  if (!provider.ok) return provider;
  const startsAt = request.startAt ?? world.time;
  const duration =
    request.action === "buy" || request.action === "repay" ? 0 : doc.serviceMinutes[request.action];
  const endsAt = startsAt + duration;
  if (duration && !clinic.equipment.includes("surgery"))
    return { ok: false, reason: "诊所缺少可用手术设备" };
  if (
    duration &&
    Object.values(state.services).some(
      (service) =>
        service.id !== options.service &&
        ["booked", "active"].includes(service.status) &&
        service.provider === provider.id &&
        service.scheduledAt < endsAt &&
        service.endsAt > startsAt,
    )
  )
    return { ok: false, reason: `${provider.name}在这个时段已有服务预约` };
  const common = {
    providerId: provider.id,
    part: request.part ?? null,
    disposition: null,
    startsAt,
    endsAt,
    stockRevision: clinic.revision,
    debtDue: request.credit && doc.creditDays !== null ? startsAt + doc.creditDays * 1440 : null,
  } as const;
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  const debtAmount = state.debts
    .filter((d) => d.doc === doc.id)
    .reduce((sum, d) => sum + d.amount, 0);
  if (request.action === "repay") {
    if (
      request.offer ||
      request.id ||
      request.part ||
      request.replace ||
      request.tradeIn ||
      request.credit ||
      request.disposition
    ) {
      return { ok: false, reason: "还清义体欠款只需指定医生，不接受商品、换件或改价条件" };
    }
    if (!debtAmount) return { ok: false, reason: `不欠${doc.name}的钱` };
    return {
      ok: true,
      quote: {
        ...common,
        action: "repay",
        doc: doc.id,
        docName: doc.name,
        provider: provider.name,
        name: "还清义体欠款",
        price: debtAmount,
        tradeIn: 0,
        total: debtAmount,
        cash: debtAmount,
        credit: 0,
        receive: 0,
        replaces: null,
        offer: null,
        blocked:
          debtAmount > eddies || debtAmount > MONEY_CAP
            ? `无法一次还清：欠${doc.name} ${debtAmount}，余额或单笔现金额度不足`
            : null,
      },
    };
  }
  const catalog = cyberwareCatalog(data);
  const owned = request.part ? state.parts[request.part] : undefined;
  const def = catalog.get(request.id ?? owned?.model ?? "");
  if (!def) return { ok: false, reason: `义体表里没有 ${request.id ?? "指定义体"}` };
  if (
    request.part &&
    (!owned ||
      owned.model !== def.id ||
      owned.holder !== "player" ||
      owned.condition === "scrapped" ||
      (owned.location !== null &&
        owned.location !== location &&
        !merchantAt(data, doc.id, doc.location, owned.location)))
  )
    return { ok: false, reason: "指定自带义体不在玩家实际持有的可用实物中" };
  const disposition = request.disposition ?? (request.tradeIn === true ? "sell" : undefined);
  if (request.tradeIn === true && disposition !== "sell")
    return { ok: false, reason: "旧件出售授权与处置方式冲突" };
  const installed = state.installed.some((c) => c.id === def.id);
  let price = 0;
  let tradeIn = 0;
  let receive = 0;
  let replaces: CyberwareQuote["replaces"] = null;
  const fullPrice = Math.round((def.price * doc.priceFactor) / 100) * 100;
  const servicePrice = Math.round((fullPrice * doc.serviceRate) / 100) * 100;
  if (request.action === "install" || request.action === "buy") {
    if (request.action === "buy" && (request.part || request.replace || disposition))
      return { ok: false, reason: "只买下义体不拆旧、不安装自带件" };
    if (!request.part && actualStock(state, doc, def.id, world.time, data) < 1)
      return { ok: false, reason: `${doc.name}没有${def.name}的实际现货，须等待有来源的供货` };
    if (installed && request.action === "install")
      return { ok: false, reason: `${def.name}已经装着了` };
    if (owned?.condition === "damaged")
      return { ok: false, reason: "自带件已损坏，需先维修再安装" };
    const inSlot = state.installed.filter((c) => c.slot === def.slot);
    if (request.replace) {
      const previous = inSlot.find((c) => c.id === request.replace);
      const old = previous ? catalog.get(previous.id) : undefined;
      if (!old) return { ok: false, reason: "指定换下的义体没有装在这个部位，不能替换" };
      if (!disposition) return { ok: false, reason: `尚未授权${old.name}的保留、出售或报废去向` };
      replaces = { id: old.id, name: old.name };
      tradeIn = disposition === "sell" ? tradeInValue(old) : 0;
    } else if (request.action === "install" && inSlot.length >= SLOT_CAPACITY[def.slot]) {
      return { ok: false, reason: "这个部位已经装满；请先明确要换下哪件义体以及是否同意出售旧件" };
    } else if (disposition) {
      return { ok: false, reason: "折抵旧件需要指定实际换下的义体" };
    }
    price =
      request.action === "buy" ? fullPrice - servicePrice : request.part ? servicePrice : fullPrice;
    tradeIn = Math.min(price, tradeIn);
  } else {
    if (!installed && !request.part) return { ok: false, reason: `没有装着${def.name}` };
    if (request.replace || request.credit)
      return { ok: false, reason: "拆卸和维修不接受替换目标或新赊账" };
    if (request.action === "remove") {
      if (request.part) return { ok: false, reason: "未安装实物不能再次拆卸" };
      if (!disposition) return { ok: false, reason: `尚未授权${def.name}的保留、出售或报废去向` };
      if (disposition === "sell") receive = tradeInValue(def);
      else price = Math.round(servicePrice / 200) * 100;
    } else {
      if (disposition) return { ok: false, reason: "维修不会处置义体" };
      if (
        request.part
          ? owned?.condition !== "damaged"
          : !HealthStateSchema.parse(world.slices.health).brokenChrome.includes(def.id)
      ) {
        return { ok: false, reason: `${def.name}没坏` };
      }
      price = repairCost(def);
    }
  }
  const agreement = agreedQuote(world, {
    seller: doc.id,
    kind: "cyberware",
    action: request.action,
    target: def.id,
    offer: request.offer,
    replace: request.replace,
    tradeIn: disposition === "sell",
    part: request.part,
    disposition,
  });
  if (!agreement.ok) return agreement;
  let total = price - tradeIn;
  if (agreement.quote) {
    if (request.action === "remove" && disposition === "sell") receive = agreement.quote.price;
    else {
      // 约定金额已经是净价；只为原面板还原折抵前金额，不能再从 total 减一次。
      total = agreement.quote.price;
      price = total + tradeIn;
    }
  }
  let cash = total;
  let credit = 0;
  let blocked: string | null = null;
  if (total > eddies && options.checkFunds !== false) {
    if (!["install", "buy"].includes(request.action) || !request.credit)
      blocked = `欧元不够：${def.name}要 ${total}，身上只有 ${eddies}`;
    else if (doc.credit === 0) blocked = `${doc.name}不赊账`;
    else if (total - eddies + debtAmount > doc.credit)
      blocked = `${doc.name}剩余可赊额度 ${Math.max(0, doc.credit - debtAmount)} 欧元，还差 ${total - eddies}`;
    else {
      cash = eddies;
      credit = total - eddies;
    }
  }
  if (cash > MONEY_CAP || receive > MONEY_CAP) {
    blocked = `本次现金对价超过单笔 ${MONEY_CAP} 欧元的结算范围，需要重新约定交易条件`;
  }
  return {
    ok: true,
    quote: {
      ...common,
      disposition: disposition ?? null,
      action: request.action,
      doc: doc.id,
      docName: doc.name,
      provider: provider.name,
      id: def.id,
      name: def.name,
      price,
      tradeIn,
      total,
      cash,
      credit,
      receive,
      replaces,
      offer: agreement.quote?.id ?? null,
      blocked,
    },
  };
}
