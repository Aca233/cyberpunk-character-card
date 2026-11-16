import { z } from "zod";
import type { WorldState } from "../../kernel/world";
import { agreedQuote } from "../commerce";
import { EconomyStateSchema, MONEY_CAP } from "../economy";
import { HealthStateSchema } from "../health";
import { WorldClockStateSchema } from "../world";
import { cyberwareCatalog, repairCost, ripperdocList, tradeInValue } from "./apply";
import {
  type CyberwareCommand,
  CyberwareStateSchema,
  type Ripperdoc,
  SLOT_CAPACITY,
} from "./schema";

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
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string } {
  const ids = [...(doc.keeperNpc ? [doc.keeperNpc] : []), ...doc.serviceNpcs];
  if (ids.length === 0) return { ok: true, name: doc.name };
  for (const id of ids) {
    const person = roster[id];
    if (!person) return { ok: true, name: id === doc.keeperNpc ? doc.name : id };
    if (person.alive && (person.location == null || person.location === doc.location)) {
      return { ok: true, name: person.name };
    }
  }
  return { ok: false, reason: `${doc.name}的诊所当前没有已登记的在场医生可以提供服务` };
}

export type CyberwareQuoteRequest = Pick<
  CyberwareCommand,
  "action" | "doc" | "id" | "replace" | "tradeIn" | "credit" | "offer"
>;

export interface CyberwareQuote {
  readonly action: CyberwareQuoteRequest["action"];
  readonly doc: string;
  readonly docName: string;
  readonly provider: string;
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
): CyberwareQuoteResult {
  const doc = ripperdocList(data).find((d) => d.id === request.doc);
  if (!doc) return { ok: false, reason: `没有叫 ${request.doc} 的义体医生` };
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  if (location !== doc.location) return { ok: false, reason: `不在${doc.name}的诊所，先去那里` };
  const provider = clinicProvider(doc, DoctorRosterSchema.parse(world.slices.npc ?? {}).npcs);
  if (!provider.ok) return provider;
  const state = CyberwareStateSchema.parse(world.slices.cyberware);
  const eddies = EconomyStateSchema.parse(world.slices.economy).eddies;
  const debt = state.debts.find((d) => d.doc === doc.id);
  if (request.action === "repay") {
    if (request.offer || request.id || request.replace || request.tradeIn || request.credit) {
      return { ok: false, reason: "还清义体欠款只需指定医生，不接受商品、换件或改价条件" };
    }
    if (!debt) return { ok: false, reason: `不欠${doc.name}的钱` };
    return {
      ok: true,
      quote: {
        action: "repay",
        doc: doc.id,
        docName: doc.name,
        provider: provider.name,
        name: "还清义体欠款",
        price: debt.amount,
        tradeIn: 0,
        total: debt.amount,
        cash: debt.amount,
        credit: 0,
        receive: 0,
        replaces: null,
        offer: null,
        blocked:
          debt.amount > eddies
            ? `欧元不够：欠${doc.name} ${debt.amount}，身上只有 ${eddies}`
            : null,
      },
    };
  }
  const catalog = cyberwareCatalog(data);
  const def = request.id ? catalog.get(request.id) : undefined;
  if (!def) return { ok: false, reason: `义体表里没有 ${request.id ?? "指定义体"}` };
  const installed = state.installed.some((c) => c.id === def.id);
  let price = 0;
  let tradeIn = 0;
  let receive = 0;
  let replaces: CyberwareQuote["replaces"] = null;
  if (request.action === "install") {
    if (!doc.shelf.includes(def.id))
      return { ok: false, reason: `${doc.name}的货架上没有${def.name}` };
    if (installed) return { ok: false, reason: `${def.name}已经装着了` };
    const inSlot = state.installed.filter((c) => c.slot === def.slot);
    if (request.replace) {
      const previous = inSlot.find((c) => c.id === request.replace);
      const old = previous ? catalog.get(previous.id) : undefined;
      if (!old) return { ok: false, reason: "指定换下的义体没有装在这个部位，不能替换" };
      if (request.tradeIn !== true)
        return { ok: false, reason: `尚未授权出售${old.name}；保留旧件的安装服务尚未实现` };
      replaces = { id: old.id, name: old.name };
      tradeIn = tradeInValue(old);
    } else if (inSlot.length >= SLOT_CAPACITY[def.slot]) {
      return { ok: false, reason: "这个部位已经装满；请先明确要换下哪件义体以及是否同意出售旧件" };
    } else if (request.tradeIn) {
      return { ok: false, reason: "折抵旧件需要指定实际换下的义体" };
    }
    price = Math.round((def.price * doc.priceFactor) / 100) * 100;
    tradeIn = Math.min(price, tradeIn);
  } else {
    if (!installed) return { ok: false, reason: `没有装着${def.name}` };
    if (request.replace || request.credit)
      return { ok: false, reason: "拆卸和维修不接受替换目标或新赊账" };
    if (request.action === "remove") {
      if (request.tradeIn !== true)
        return { ok: false, reason: `尚未授权出售${def.name}；保留拆下旧件的服务尚未实现` };
      receive = tradeInValue(def);
    } else {
      if (request.tradeIn) return { ok: false, reason: "维修不会出售义体" };
      if (!HealthStateSchema.parse(world.slices.health).brokenChrome.includes(def.id)) {
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
    tradeIn: request.tradeIn,
  });
  if (!agreement.ok) return agreement;
  let total = request.action === "remove" ? 0 : price - tradeIn;
  if (agreement.quote) {
    if (request.action === "remove") receive = agreement.quote.price;
    else {
      // 约定金额已经是净价；只为原面板还原折抵前金额，不能再从 total 减一次。
      total = agreement.quote.price;
      price = total + tradeIn;
    }
  }
  let cash = total;
  let credit = 0;
  let blocked: string | null = null;
  if (total > eddies) {
    if (request.action !== "install" || !request.credit)
      blocked = `欧元不够：${def.name}要 ${total}，身上只有 ${eddies}`;
    else if (doc.credit === 0) blocked = `${doc.name}不赊账`;
    else if (debt) blocked = `还欠着${doc.name} ${debt.amount} 欧元，先还清才能再赊`;
    else if (total - eddies > doc.credit)
      blocked = `${doc.name}最多赊 ${doc.credit} 欧元，还差 ${total - eddies}`;
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
