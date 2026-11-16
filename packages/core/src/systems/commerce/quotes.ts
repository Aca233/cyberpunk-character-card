import type { WorldState } from "../../kernel/world";
import { type AgreedQuote, CommerceStateSchema } from "./schema";

export type QuoteWorld = Pick<WorldState, "time" | "slices">;
export interface QuoteSelector {
  readonly seller: string;
  readonly kind: AgreedQuote["kind"];
  readonly action: AgreedQuote["action"];
  readonly target: string;
  readonly offer?: string | undefined;
  readonly replace?: string | undefined;
  readonly tradeIn?: boolean | undefined;
}

export function sameQuoteTerms(a: QuoteSelector, b: QuoteSelector): boolean {
  return (
    a.seller === b.seller &&
    a.kind === b.kind &&
    a.action === b.action &&
    a.target === b.target &&
    a.replace === b.replace &&
    (a.tradeIn ?? false) === (b.tradeIn ?? false)
  );
}

export function agreedQuote(
  world: QuoteWorld,
  selector: QuoteSelector,
):
  | { readonly ok: true; readonly quote: AgreedQuote | null }
  | { readonly ok: false; readonly reason: string } {
  const quotes = CommerceStateSchema.parse(world.slices.commerce ?? {}).quotes;
  if (selector.offer !== undefined) {
    const quote = quotes[selector.offer];
    if (!quote || !sameQuoteTerms(quote, selector))
      return { ok: false, reason: "报价不存在或交易对象、物件、旧件条件不一致" };
    if (quote.status !== "offered" || (quote.expiresAt !== null && quote.expiresAt <= world.time))
      return { ok: false, reason: "报价已使用、撤回或到期，需要重新确认条件" };
    return { ok: true, quote };
  }
  const matching = Object.values(quotes).filter((q) => sameQuoteTerms(q, selector));
  // 旧的已消费报价不阻止下一次按货架买；仍在有效期内的谈妥条件优先。
  const quote =
    matching
      .filter((q) => q.status === "offered" && (q.expiresAt === null || q.expiresAt > world.time))
      .sort((a, b) => b.at - a.at)[0] ?? null;
  return { ok: true, quote };
}

export function registeredParty(world: QuoteWorld, id: string) {
  return CommerceStateSchema.parse(world.slices.commerce ?? {}).parties[id];
}

export function tradeEvidence(facts: Readonly<Record<string, unknown>>, quote: string): boolean {
  const source = facts.tradeNarrative;
  if (typeof source !== "string") return false;
  const clean = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");
  return clean(source).includes(clean(quote));
}

/** 只能核对引文包含所报金额；是否为对方认可的最终对价仍须由抽取按语义判断。 */
export function priceMentioned(evidence: string, price: number): boolean {
  const text = evidence.normalize("NFKC").replace(/[,，](?=\d{3}(?:\D|$))/g, "");
  if (price === 0 && /免费|白送|不收钱|分文不取/.test(text)) return true;
  for (const match of text.matchAll(/\d+(?:\.\d+)?\s*[千万]?/g)) {
    const raw = match[0].trim();
    const factor = raw.endsWith("万") ? 10000 : raw.endsWith("千") ? 1000 : 1;
    if (Number(raw.replace(/[千万]/g, "")) * factor === price) return true;
  }
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  for (const match of text.matchAll(/[零〇一二两三四五六七八九十百千万]+/g)) {
    const raw = match[0];
    if (!/[十百千万]/.test(raw)) {
      if (Number([...raw].map((c) => digits[c]).join("")) === price) return true;
      continue;
    }
    let total = 0;
    let section = 0;
    let digit = 0;
    for (const c of raw) {
      if (c === "万") {
        total += (section + digit) * 10000;
        section = 0;
        digit = 0;
      } else if (units[c]) {
        section += (digit || 1) * units[c];
        digit = 0;
      } else digit = digits[c] ?? 0;
    }
    if (total + section + digit === price) return true;
  }
  return false;
}
