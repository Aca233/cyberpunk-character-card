import { z } from "zod";
import { GameTimeSchema } from "../world";

/** 一次正文活动所需的约定，不是订单或预约平台。 */
export const ServiceTermsSchema = z.object({
  subject: z.string().trim().min(1).max(80).describe("本次实际作品 id 或成年服务者人物 id"),
  scope: z.string().trim().min(1).max(600).describe("双方已经接受的实际服务范围与底线"),
  duration: z.number().int().min(1).max(1440).describe("本次约定的总游戏分钟"),
  recording: z.boolean().describe("是否明确允许记录；允许不代表已经录制或同意传播"),
  earlyExit: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe("已说明的中止条件；不临时追加费用或自动退款"),
});
export type ServiceTerms = z.infer<typeof ServiceTermsSchema>;

export const ServiceSessionSchema = z.object({
  id: z.string().min(1),
  seller: z.string().min(1),
  service: z.enum(["bd-session", "adult-service"]),
  terms: ServiceTermsSchema,
  price: z.number().int().min(0),
  location: z.string().min(1),
  paidAt: z.number().int(),
  elapsed: z.number().int().min(0),
  status: z.enum(["active", "paused", "finished", "exited"]),
});
export type ServiceSession = z.infer<typeof ServiceSessionSchema>;

export const QuoteTermsSchema = z.object({
  seller: z.string().trim().min(1).max(80).describe("交易对方的商店、医生或人物稳定 id，不写玩家"),
  kind: z.enum(["item", "service", "cyberware", "gunsmith"]),
  action: z.enum(["buy", "sell", "service", "install", "remove", "repair", "detach", "convert"]),
  target: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("这一件商品、义体或服务的 id；一份报价对应一次单件交付"),
  replace: z.string().min(1).optional().describe("安装义体需要替换时，双方明确约定拆下的旧义体 id"),
  part: z.string().min(1).optional().describe("自带义体实物 id；该报价不含另一件义体的购入"),
  disposition: z.enum(["keep", "sell", "scrap"]).optional().describe("旧件明确去向"),
  tradeIn: z
    .boolean()
    .default(false)
    .describe("是否已明确约定出售旧义体；仅报价不等于玩家已授权拆卸"),
  session: ServiceTermsSchema.optional().describe("超梦按次体验或成人服务必须明确的本次条件"),
});

export const AgreedQuoteSchema = QuoteTermsSchema.extend({
  id: z.string().min(1).max(80),
  price: z.number().int().min(0).max(200_000),
  evidence: z.string().trim().min(2).max(500),
  at: z.number().int(),
  expiresAt: z.number().int().nullable(),
  status: z.enum(["offered", "used", "withdrawn"]),
});
export type AgreedQuote = z.infer<typeof AgreedQuoteSchema>;

export const PartySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(40),
  location: z.string().min(1),
});

export const CommerceStateSchema = z.object({
  quotes: z.record(z.string(), AgreedQuoteSchema).default({}),
  parties: z.record(z.string(), PartySchema).default({}),
  sessions: z.record(z.string(), ServiceSessionSchema).default({}),
});
export type CommerceState = z.infer<typeof CommerceStateSchema>;

export const OfferCommandSchema = QuoteTermsSchema.extend({
  type: z.literal("commerce.offer"),
  id: z.string().min(1).max(80).describe("新报价的稳定 id，不能复用已用过或撤回的报价 id"),
  price: z
    .number()
    .int()
    .min(0)
    .max(200_000)
    .describe(
      "卖方明确认可的本次最终现金对价；安装已包含约定旧件折抵，不再重复减价；卖出/拆卸为玩家所得。免费必须确有赠与。",
    ),
  evidence: z
    .string()
    .trim()
    .min(2)
    .max(500)
    .describe(
      "逐字引用本轮正文中对方报出或接受价格与交易条件的原话；不能只引用玩家出价、意向、假设或未获回应的要求",
    ),
  expiresAt: GameTimeSchema.optional().describe("仅对方明确说了报价有效期时填写，不自行设截止时间"),
  party: z
    .object({ name: z.string().trim().min(1).max(40), location: z.string().min(1) })
    .optional()
    .describe(
      "尚无人物卡的现场服务者，首次报价时登记姓名和当前地点；已有商店/医生/人物不用重复登记",
    ),
})
  .superRefine((offer, ctx) => {
    const valid =
      offer.kind === "item"
        ? ["buy", "sell"]
        : offer.kind === "service"
          ? ["service"]
          : offer.kind === "gunsmith"
            ? ["install", "detach", "convert"]
            : ["buy", "install", "remove", "repair"];
    if (!valid.includes(offer.action))
      ctx.addIssue({ code: "custom", message: "报价种类与交易动作不一致" });
    if (
      offer.kind !== "cyberware" &&
      (offer.replace !== undefined ||
        offer.tradeIn ||
        offer.part !== undefined ||
        offer.disposition !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "只有义体报价可以约定旧件" });
    const experiential =
      offer.kind === "service" && ["bd-session", "adult-service"].includes(offer.target);
    if (experiential !== (offer.session !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "超梦按次与成人服务必须给出本次完整条件；其他交易不填写 session",
      });
  })
  .describe(
    "保存对方已认可的报价，不扣款、不交货、不代表玩家接受。后续成交引用 offer id；未成交的报价会持续保留。",
  );

export const WithdrawOfferSchema = z.object({
  type: z.literal("commerce.withdraw"),
  id: z.string().min(1),
  evidence: z.string().trim().min(2).max(500).describe("本轮正文中对方明确撤回报价的原文"),
});

export const UsedOfferSchema = z.object({
  type: z.literal("commerce.used"),
  id: z.string().min(1),
});

/** 仅成功 trade 事务发出：同报价的一次付款与一次活动绑定。 */
export const PaidServiceSchema = z.object({
  type: z.literal("commerce.servicePaid"),
  id: z.string().min(1),
});

/** 超梦自己结算时间，这里只同步已实际消费的累计分钟。 */
export const SessionProgressSchema = z.object({
  type: z.literal("commerce.sessionProgress"),
  id: z.string().min(1),
  elapsed: z.number().int().min(0),
  status: z.enum(["active", "paused", "finished", "exited"]),
});

export const ServiceCommandSchema = z
  .object({
    type: z.literal("commerce.service"),
    id: z.string().min(1).describe("已经实际成交的成人服务报价 id"),
    action: z.enum(["progress", "pause", "resume", "finish", "exit"]),
    elapsed: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("实际累计服务分钟，不是本轮增量；finish 省略时补足剩余约定时长"),
    evidence: z
      .string()
      .trim()
      .min(2)
      .max(600)
      .describe("本轮正文里真实继续、暂停、结束或中止的原文"),
  })
  .describe(
    "已经接受的成人服务正文进度，不重新扣款；略写正常结束仍经过剩余约定分钟。超梦进度使用 braindance 指令。",
  );
export type ServiceCommand = z.infer<typeof ServiceCommandSchema>;

export type CommerceCommand =
  | z.infer<typeof OfferCommandSchema>
  | z.infer<typeof WithdrawOfferSchema>
  | ServiceCommand;
export type CommerceInternal =
  | z.infer<typeof UsedOfferSchema>
  | z.infer<typeof PaidServiceSchema>
  | z.infer<typeof SessionProgressSchema>;
