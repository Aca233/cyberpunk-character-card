import { defineSystem } from "../../kernel/system";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import { priceMentioned, sameQuoteTerms, tradeEvidence } from "./quotes";
import {
  type CommerceCommand,
  type CommerceInternal,
  type CommerceState,
  CommerceStateSchema,
  OfferCommandSchema,
  UsedOfferSchema,
  WithdrawOfferSchema,
} from "./schema";

export const commerce = defineSystem<CommerceState, CommerceCommand, CommerceInternal>({
  id: "commerce",
  dependsOn: ["world", "npc"],
  state: CommerceStateSchema,
  initial: () => ({ quotes: {}, parties: {} }),
  commands: { "commerce.offer": OfferCommandSchema, "commerce.withdraw": WithdrawOfferSchema },
  internal: { "commerce.used": UsedOfferSchema },
  apply(draft, command, ctx) {
    if (command.type !== "commerce.offer") {
      const quote = draft.quotes[command.id];
      if (quote?.status !== "offered") return { ok: false, reason: "报价不存在或已处理" };
      if (command.type === "commerce.used") {
        if (quote.expiresAt !== null && quote.expiresAt <= ctx.now)
          return { ok: false, reason: "报价已到期" };
        quote.status = "used";
      } else {
        if (!tradeEvidence(ctx.facts, command.evidence))
          return { ok: false, reason: "撤回报价缺少本轮正文证据" };
        quote.status = "withdrawn";
      }
      return { ok: true };
    }
    if (!tradeEvidence(ctx.facts, command.evidence))
      return { ok: false, reason: "报价缺少本轮正文中的对方承诺证据" };
    if (!priceMentioned(command.evidence, command.price))
      return { ok: false, reason: "报价金额与引用正文不符，不能凭空改价" };
    if (draft.quotes[command.id])
      return { ok: false, reason: "报价 id 已存在，不能覆盖已确认条件" };
    if (command.expiresAt !== undefined && command.expiresAt <= ctx.now)
      return { ok: false, reason: "新报价已经到期" };
    const people = ctx.read<NpcState>("npc").npcs;
    const known = [ctx.data.shops, ctx.data.ripperdocs].some(
      (rows) => Array.isArray(rows) && rows.some((row) => row?.id === command.seller),
    );
    const person = people[command.seller];
    if (person && !person.alive) return { ok: false, reason: "已死亡的人物不能提出新报价" };
    const location = ctx.read<WorldClockState>("world").location;
    if (!known && !person && !draft.parties[command.seller]) {
      if (!command.party || command.party.location !== location)
        return { ok: false, reason: "未知交易对方需要登记现场身份和地点" };
      draft.parties[command.seller] = { id: command.seller, ...command.party };
    } else if (command.party) return { ok: false, reason: "已有交易对方不重复登记或改写身份" };
    for (const old of Object.values(draft.quotes)) {
      if (old.status === "offered" && sameQuoteTerms(old, command)) old.status = "withdrawn";
    }
    const { type: _type, party: _party, expiresAt, ...terms } = command;
    draft.quotes[command.id] = {
      ...terms,
      at: ctx.now,
      expiresAt: expiresAt ?? null,
      status: "offered",
    };
    return { ok: true, notes: ["已记录对方报价；报价本身不支付或交付"] };
  },
  rules: [
    {
      id: "commerce",
      title: "交易约定",
      commands: ["commerce.offer", "commerce.withdraw"],
      when: (state, input) =>
        Object.values(state.quotes).some((q) => q.status === "offered") ||
        /买|卖|价格|报价|砍价|讲价|赊|赠|免费|交换|安装|维修|拆卸|吃|喝|住/.test(input.text),
      judge:
        "- 询价、讨价还价和提出条件不等于购买。花钱意图须指明实际交易对方和物件；已谈妥条件引用报价 id，不另猜折扣。",
      narrate:
        "- 同一交易的报价、货源和拒售原因沿用给定事实；可以继续商谈或提出新条件。报价成立不代表玩家已接受，不替玩家完成购买、赊账或出售旧义体。",
      text: "- 对方明确认可的新价格与条件写 commerce.offer，evidence 逐字引用本轮正文中的对方报价；玩家单方面要求、假设和打算不算。price 是本次单件最终现金对价，义体安装已包含约定折抵，不再重复扣抵。仅保存报价不发 trade 或 cyberware。确实成交时引用 offer id，钱货由同一交易指令完成，不另发 item gain 或 money。已有报价撤回须有正文依据。没有人物卡的现场服务者可随报价登记 party，不借此伪造私人货源。",
    },
  ],
  sections: [
    {
      order: 77,
      title: "交易报价",
      render: ({ world, input, data }) => {
        const state = CommerceStateSchema.parse(world.slices.commerce ?? {});
        const here = (world.slices.world as WorldClockState).location;
        const parties = Object.values(state.parties).filter(
          (p) => p.location === here || input.text.includes(p.name) || input.text.includes(p.id),
        );
        const quotes = Object.values(state.quotes).filter(
          (q) => q.status === "offered" && (q.expiresAt === null || q.expiresAt > world.time),
        );
        const localSellers = new Set(parties.map((p) => p.id));
        for (const rows of [data?.shops, data?.ripperdocs]) {
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (row.location === here || input.text.includes(row.name)) localSellers.add(row.id);
          }
        }
        const people = (world.slices.npc as NpcState).npcs;
        for (const person of Object.values(people)) {
          if (person.location === here || input.text.includes(person.name))
            localSellers.add(person.id);
        }
        // 报价是未兑现承诺；完整保留在存档，当前请求只带有关对象。
        const relevant = quotes.filter(
          (q) =>
            input.text.includes(q.id) ||
            input.text.includes(q.target) ||
            input.text.includes(q.seller) ||
            localSellers.has(q.seller),
        );
        const lines = [
          ...parties.map((p) => `交易对方 ${p.id}：${p.name}，地点 ${p.location}`),
          ...relevant.map(
            (q) =>
              `报价 ${q.id}：${q.seller} ${q.action} ${q.target}，最终对价 ${q.price} 欧元${q.replace ? `；拆下 ${q.replace}` : ""}${q.tradeIn ? "；出售旧件" : ""}；尚未成交；来源：${q.evidence}`,
          ),
        ];
        return lines.length ? lines.join("\n") : undefined;
      },
    },
  ],
});

export * from "./quotes";
export * from "./schema";
