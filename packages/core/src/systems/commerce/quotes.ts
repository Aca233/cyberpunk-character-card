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
  readonly part?: string | undefined;
  readonly disposition?: "keep" | "sell" | "scrap" | undefined;
}

export interface NarratedPurchase {
  readonly seller: string;
  readonly kind: AgreedQuote["kind"];
  readonly action: string;
  readonly target: string;
  readonly price: number;
  readonly replace?: string | undefined;
  readonly tradeIn?: boolean | undefined;
  readonly cash?: number | undefined;
  readonly credit?: number | undefined;
  readonly creditAllowed?: boolean | undefined;
  readonly part?: string | undefined;
  readonly disposition?: "keep" | "sell" | "scrap" | undefined;
  readonly startsAt?: number | undefined;
  readonly endsAt?: number | undefined;
  readonly provider?: string | undefined;
  readonly stockRevision?: number | undefined;
  readonly serviceOrder?: string | undefined;
  readonly debtDue?: number | null | undefined;
  readonly weapon?: string | undefined;
  readonly mod?: string | undefined;
  readonly source?: "shelf" | "backpack" | undefined;
  readonly slot?: string | undefined;
  readonly conversion?: "smart-link" | "precision-lock" | undefined;
  readonly lock?: boolean | undefined;
}

/** 正文开始前已给出的交易不能在抽取时换对象或改价；未形成报价时只能继续商谈。 */
export function checkNarratedPurchase(
  facts: Readonly<Record<string, unknown>>,
  actual: NarratedPurchase,
): string | undefined {
  if (typeof facts.tradeQuoteError === "string") return facts.tradeQuoteError;
  const expected = facts.tradeQuote as NarratedPurchase | undefined;
  if (!expected)
    return typeof facts.tradeNarrative === "string"
      ? "本轮未确认成交意图，只能询价或商谈，不能扣款、借款或交付"
      : undefined;
  if (
    expected.seller !== actual.seller ||
    expected.kind !== actual.kind ||
    expected.action !== actual.action ||
    expected.target !== actual.target ||
    expected.price !== actual.price ||
    expected.replace !== actual.replace ||
    (expected.tradeIn ?? false) !== (actual.tradeIn ?? false) ||
    expected.cash !== actual.cash ||
    expected.credit !== actual.credit ||
    (expected.creditAllowed ?? false) !== (actual.creditAllowed ?? false) ||
    expected.part !== actual.part ||
    (expected.disposition ?? (expected.tradeIn ? "sell" : undefined)) !==
      (actual.disposition ?? (actual.tradeIn ? "sell" : undefined)) ||
    expected.startsAt !== actual.startsAt ||
    expected.endsAt !== actual.endsAt ||
    expected.provider !== actual.provider ||
    expected.stockRevision !== actual.stockRevision ||
    expected.serviceOrder !== actual.serviceOrder ||
    expected.debtDue !== actual.debtDue ||
    expected.weapon !== actual.weapon ||
    expected.mod !== actual.mod ||
    expected.source !== actual.source ||
    expected.slot !== actual.slot ||
    expected.conversion !== actual.conversion ||
    (expected.lock ?? false) !== (actual.lock ?? false)
  )
    return "成交对象、金额或旧件条件与正文前确认的报价不同，需要重新确认";
  return undefined;
}

export function sameQuoteTerms(a: QuoteSelector, b: QuoteSelector): boolean {
  return (
    a.seller === b.seller &&
    a.kind === b.kind &&
    a.action === b.action &&
    a.target === b.target &&
    a.replace === b.replace &&
    (a.tradeIn ?? false) === (b.tradeIn ?? false) &&
    a.part === b.part &&
    (a.disposition ?? (a.tradeIn ? "sell" : undefined)) ===
      (b.disposition ?? (b.tradeIn ? "sell" : undefined))
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

export function normalizeEvidenceText(text: string): string {
  return text.normalize("NFKC").replace(/[\s，。、；：！？""''「」『』（）()【】[\]—\-…·,.!?;:'"`]+/g, "");
}

export function tradeEvidence(facts: Readonly<Record<string, unknown>>, quote: string): boolean {
  const source = facts.tradeNarrative;
  if (typeof source !== "string") return false;
  const needle = normalizeEvidenceText(quote);
  return needle.length > 0 && normalizeEvidenceText(source).includes(needle);
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
    let lastUnit = 1;
    let explicitZero = false;
    for (const c of raw) {
      if (c === "万") {
        total += (section + digit) * 10000;
        section = 0;
        digit = 0;
        lastUnit = 10000;
        explicitZero = false;
      } else if (units[c]) {
        section += (digit || 1) * units[c];
        digit = 0;
        lastUnit = units[c];
        explicitZero = false;
      } else {
        digit = digits[c] ?? 0;
        if (digit === 0) explicitZero = true;
      }
    }
    // 常见口语省略末位单位：“一千二”=1200，“一万二”=12000；写零则保持个位。
    if (lastUnit >= 100 && !explicitZero) digit *= lastUnit / 10;
    if (total + section + digit === price) return true;
  }
  return false;
}
