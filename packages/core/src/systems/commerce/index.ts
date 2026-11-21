import { defineSystem } from "../../kernel/system";
import type { NpcState } from "../npc";
import { merchantAt, type WorldClockState } from "../world";
import { priceMentioned, sameQuoteTerms, tradeEvidence } from "./quotes";
import {
  type CommerceCommand,
  type CommerceInternal,
  type CommerceState,
  CommerceStateSchema,
  OfferCommandSchema,
  ServiceCommandSchema,
  UsedOfferSchema,
  WithdrawOfferSchema,
} from "./schema";
import { applyService, serviceSessionText } from "./services";

export const commerce = defineSystem<CommerceState, CommerceCommand, CommerceInternal>({
  id: "commerce",
  dependsOn: ["world", "npc"],
  state: CommerceStateSchema,
  initial: () => ({ quotes: {}, parties: {}, sessions: {} }),
  commands: {
    "commerce.offer": OfferCommandSchema,
    "commerce.withdraw": WithdrawOfferSchema,
    "commerce.service": ServiceCommandSchema,
  },
  internal: {
    "commerce.used": UsedOfferSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "commerce.service") return applyService(draft, command, ctx);
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
      commands: ["commerce.offer", "commerce.withdraw", "commerce.service"],
      when: (state, input) =>
        Object.values(state.quotes).some((q) => q.status === "offered") ||
        Object.values(state.sessions).some((s) => ["active", "paused"].includes(s.status)) ||
        /买|卖|价格|报价|砍价|讲价|赊|赠|免费|交换|安装|维修|拆卸|吃|喝|住|超梦|性偶|玩偶|云顶|扭扭街|丽姿|服务/.test(
          input.text,
        ),
      judge:
        "- 询价、讨价还价和提出条件不等于购买。花钱意图须指明实际交易对方和物件；已谈妥条件引用报价 id，不另猜折扣。",
      narrate:
        "- 同一交易的报价、货源和拒售原因沿用给定事实；报价成立不代表玩家已接受，不替玩家完成购买、赊账或出售旧义体。会所点播超梦与街头/云顶服务按自然对话成交即可，不把夜之城消费写成法务表单。",
      text: "- 对方明确认可的新价格写 commerce.offer（evidence 引用本轮正文中的对方报价）；仅保存报价不发 trade 或 cyberware。确实成交时发 trade/cyberware，钱货由同一交易指令完成，不另发 item gain 或 money。\n- 店内超梦（bd-session）与成年服务（adult-service）直接按店价或谈妥的 commerce.offer 走 trade 结算；仅在实际开展会所/街头服务时可用 commerce.service（start/pause/resume/finish/exit）记录当前在场会话，时间由 world 正常推进。",
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
            if (merchantAt(data ?? {}, row.id, row.location, here) || input.text.includes(row.name))
              localSellers.add(row.id);
          }
        }
        const people = (world.slices.npc as NpcState).npcs;
        for (const person of Object.values(people)) {
          if (person.location === here || input.text.includes(person.name))
            localSellers.add(person.id);
        }
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
              `报价 ${q.id}：${q.seller} ${q.action} ${q.target}，最终对价 ${q.price} 欧元${q.replace ? `；拆下 ${q.replace}` : ""}${q.part ? `；自带实物 ${q.part}` : ""}${q.disposition ? `；旧件去向 ${q.disposition}` : q.tradeIn ? "；出售旧件" : ""}；尚未成交；来源：${q.evidence}`,
          ),
          ...Object.values(state.sessions)
            .filter(
              (s) =>
                ["active", "paused"].includes(s.status) ||
                localSellers.has(s.seller) ||
                input.text.includes(s.id) ||
                (s.subject !== null && input.text.includes(s.subject)),
            )
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 8)
            .map(serviceSessionText),
        ];
        return lines.length ? lines.join("\n") : undefined;
      },
    },
  ],
});

export * from "./quotes";
export * from "./schema";
export * from "./services";
