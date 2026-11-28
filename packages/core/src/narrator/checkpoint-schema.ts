import { z } from "zod";
import type { LlmMessage } from "../kernel/ports";
import { TurnInputSchema } from "../schemas/turn";
import { QuoteTermsSchema } from "../systems/commerce/schema";
import { ImportanceSchema } from "../systems/memory/schema";
import { registry } from "../systems/registry";
import { EncounterDefSchema, RiskSchema, TravelModeSchema } from "../systems/travel/schema";
import { LocationDefSchema } from "../systems/world/schema";
import { ChoiceSchema, ExtractDocSchema } from "./block";
import {
  type ExtractedCheckpointData,
  type NarratedCheckpointData,
  type PreparedCheckpointData,
  type TurnCheckpoint,
  turnInputKey,
} from "./checkpoint";
import { readEventPlan } from "./event-plan";
import { BuyProposalSchema, CounterHackRulingSchema, JudgeRulingSchema } from "./stages";

const count = z.number().int().nonnegative();
const strings = z.array(z.string());
const UsageSchema = z.strictObject({
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count.optional(),
  cacheWriteTokens: count.optional(),
});
const DroppedSchema = z.strictObject({
  where: z.string(),
  raw: z.unknown(),
  reason: z.string(),
  stage: z.enum(["format", "verify", "rules"]),
});
// 调出的记忆可直接引用完整 MemoryEntry；标题/正文之外的检索信息原样保留。
const MemorySchema = z.looseObject({ title: z.string(), text: z.string() });
const MemoryEntrySchema = MemorySchema.extend({
  id: z.string(),
  kind: z.enum(["turn", "scene", "bond", "city", "anchor", "pending"]),
  people: strings,
  place: z.string().nullable(),
  at: z.number().nullable(),
  importance: ImportanceSchema,
  keywords: strings,
  activity: z.string().optional(),
});
const ExpansionSchema = z.strictObject({
  triggers: strings,
  picked: z.array(MemoryEntrySchema),
  top: z.array(
    z.strictObject({ id: z.string(), title: z.string(), score: z.number(), parts: z.string() }),
  ),
  fallback: strings,
});
const LoreTraceSchema = z.strictObject({
  terms: strings,
  picked: z.array(
    z.strictObject({
      source: z.string(),
      title: z.string(),
      kind: z.string(),
      score: z.number(),
      hits: strings,
    }),
  ),
  candidates: count,
  note: z.string().optional(),
  section: z.string().optional(),
});
const BudgetTraceSchema = z.strictObject({
  window: z.number().positive(),
  history: count,
  recapTokens: count,
  parts: z.array(
    z.strictObject({
      part: z.string(),
      label: z.string(),
      tokens: count,
      limit: z.number().nonnegative().nullable(),
    }),
  ),
  total: count,
  limit: z.number().nonnegative(),
  cuts: strings,
});
const BigSpendSchema = z.strictObject({
  label: z.string(),
  price: count,
  eddies: count,
  quoteKey: z.string().min(1),
});
const NarratedPurchaseSchema = QuoteTermsSchema.pick({
  seller: true,
  kind: true,
  target: true,
  replace: true,
  part: true,
  disposition: true,
})
  .extend({
    action: z.string(),
    price: count,
    tradeIn: z.boolean().optional(),
    cash: count.optional(),
    credit: count.optional(),
    creditAllowed: z.boolean().optional(),
    startsAt: z.number().int().optional(),
    endsAt: z.number().int().optional(),
    provider: z.string().optional(),
    stockRevision: count.optional(),
    serviceOrder: z.string().optional(),
    debtDue: z.number().int().nullable().optional(),
    weapon: z.string().optional(),
    mod: z.string().optional(),
    source: z.enum(["shelf", "backpack"]).optional(),
    slot: z.string().optional(),
    conversion: z.enum(["smart-link", "precision-lock"]).optional(),
    lock: z.boolean().optional(),
  })
  .strict();
const PurchaseQuoteSchema = z.discriminatedUnion("ok", [
  z
    .strictObject({
      ok: z.literal(true),
      label: z.string(),
      price: count,
      quoteKey: z.string().min(1),
      detail: z.string(),
      settlement: NarratedPurchaseSchema.optional(),
    })
    .transform(({ settlement, ...quote }) => ({
      ...quote,
      ...(settlement !== undefined ? { settlement } : {}),
    })),
  z.strictObject({ ok: z.literal(false), reason: z.string() }),
]);
const PreparedPurchaseSchema = z
  .strictObject({
    proposal: BuyProposalSchema.strict(),
    quote: PurchaseQuoteSchema,
    journey: z.string().optional(),
  })
  .transform(({ journey, ...purchase }) => ({
    ...purchase,
    ...(journey !== undefined ? { journey } : {}),
  }));
const RouteSchema = z
  .strictObject({
    mode: TravelModeSchema,
    vehicle: z.string().optional(),
    label: z.string(),
    minutes: z.number().int().positive(),
    cost: count,
    risk: RiskSchema,
    riskLabel: z.string(),
    warnings: strings.optional(),
    blocked: z.string().optional(),
  })
  .transform(({ vehicle, warnings, blocked, ...route }) => ({
    ...route,
    ...(vehicle !== undefined ? { vehicle } : {}),
    ...(warnings !== undefined ? { warnings } : {}),
    ...(blocked !== undefined ? { blocked } : {}),
  }));
const PlannedTripSchema = z.strictObject({
  from: LocationDefSchema.strict(),
  to: LocationDefSchema.strict(),
  route: RouteSchema,
  arriveAt: z.number().int(),
  encounter: EncounterDefSchema.strict().nullable(),
});
const MessageSchema: z.ZodType<LlmMessage> = z
  .strictObject({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
    images: z
      .array(
        z.strictObject({
          mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          data: z.string().min(1),
        }),
      )
      .optional(),
  })
  .transform(({ images, ...message }) => ({
    ...message,
    ...(images !== undefined ? { images } : {}),
  }));
const SamplingSchema = z
  .strictObject({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
  })
  .transform(({ temperature, topP, topK }) => ({
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
  }));

const PreparedSchema: z.ZodType<PreparedCheckpointData> = z
  .strictObject({
    liveInput: TurnInputSchema,
    ooc: z.boolean(),
    read: z.string().optional(),
    rulingSpec: JudgeRulingSchema.strict().optional(),
    counterHackSpec: CounterHackRulingSchema.strict().optional(),
    ruling: z.string().optional(),
    sandevistanBoosted: z.boolean(),
    activeBoost: z.strictObject({ id: z.string(), name: z.string() }).optional(),
    recalled: z.array(MemorySchema),
    expanded: z.array(MemorySchema),
    retrieval: ExpansionSchema.optional(),
    trip: PlannedTripSchema.optional(),
    purchases: z.array(PreparedPurchaseSchema),
    confirmation: BigSpendSchema.optional(),
    spend: BigSpendSchema.optional(),
    decided: strings,
    extractDecided: strings.optional(),
    newNpcLikely: z.boolean().optional(),
    loreTrace: LoreTraceSchema.optional(),
    loreSection: z.string().optional(),
    budgetTrace: BudgetTraceSchema,
    promptModules: strings,
    narrateMessages: z.array(MessageSchema).min(1),
    maxOutputTokens: z.number().int().positive(),
    sampling: SamplingSchema,
    presetName: z.string().optional(),
    narrationPreset: z
      .strictObject({
        regex: z.array(
          z.strictObject({
            id: z.string(),
            name: z.string(),
            find: z.string(),
            flags: z.string(),
            replace: z.string(),
            enabled: z.boolean(),
            promptOnly: z.boolean(),
          }),
        ),
        maxOutputTokens: z.number().int().positive().optional(),
      })
      .nullable(),
    auxUsage: UsageSchema,
    repairs: count,
    repairUsage: UsageSchema,
    notes: strings,
    dropped: z.array(DroppedSchema),
    flags: strings,
  })
  .transform((prepared) => ({
    ...prepared,
    read: prepared.read,
    rulingSpec: prepared.rulingSpec,
    counterHackSpec: prepared.counterHackSpec,
    ruling: prepared.ruling,
    activeBoost: prepared.activeBoost,
    retrieval: prepared.retrieval,
    trip: prepared.trip,
    confirmation: prepared.confirmation,
    spend: prepared.spend,
    loreTrace: prepared.loreTrace,
    loreSection: prepared.loreSection,
    presetName: prepared.presetName,
  }));
const NarratedSchema: z.ZodType<NarratedCheckpointData> = z
  .strictObject({
    narrative: z.string().refine((value) => value.trim() !== "", "已完成正文不能为空"),
    thought: z.string().optional(),
    usage: UsageSchema.optional(),
    notes: strings,
    dropped: z.array(DroppedSchema),
  })
  .transform((narrated) => ({ ...narrated, usage: narrated.usage }));

const CommandSchema = z.looseObject({ type: z.string().min(1) }).superRefine((command, ctx) => {
  const result = registry.parseInternal(command);
  if (!result.ok) ctx.addIssue({ code: "custom", message: "已结算指令不符合当前规则结构" });
});
const PatchSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("remove"),
    path: z.array(z.union([z.string(), count])),
    value: z.unknown().optional(),
  }),
  z.strictObject({
    op: z.enum(["add", "replace"]),
    path: z.array(z.union([z.string(), count])),
    value: z.unknown().refine((value) => value !== undefined, "写入补丁缺少 value"),
  }),
]);
const WorldSchema = z
  .strictObject({ time: z.number().int(), slices: z.record(z.string(), z.unknown()) })
  .superRefine((world, ctx) => {
    // 复用各系统当前 schema；不执行旧快照迁移，也不将默认值写回断点世界。
    for (const system of registry.order) {
      const raw = world.slices[system.id];
      if (raw === undefined) {
        ctx.addIssue({ code: "custom", path: ["slices", system.id], message: "缺少系统状态" });
        continue;
      }
      const result = system.state.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues)
          ctx.addIssue({ ...issue, path: ["slices", system.id, ...issue.path] });
      }
    }
  });
// 原始候选可能包含已被逐条拒绝的条目，不能要求它们再次全部通过业务 schema。
const ExtractShapeSchema = ExtractDocSchema.partial()
  .extend({
    choices: z.array(z.unknown()).optional(),
    events: z.unknown().optional(),
    sceneMemory: z.unknown().optional(),
    summary: z.unknown().optional(),
    dropped: z.array(z.unknown()).optional(),
  })
  .strict();
const ExtractedSchema: z.ZodType<ExtractedCheckpointData> = z
  .strictObject({
    shape: ExtractShapeSchema,
    choices: z.array(ChoiceSchema),
    accepted: z.array(CommandSchema),
    considered: strings,
    settledWorld: WorldSchema,
    settledPatches: z.array(PatchSchema),
    facts: z.record(z.string(), z.unknown()),
    title: z.string().optional(),
    unsettled: z.string().optional(),
    auxUsage: UsageSchema,
    repairs: count,
    repairUsage: UsageSchema,
    notes: strings,
    dropped: z.array(DroppedSchema),
  })
  .transform((extracted) => ({
    ...extracted,
    title: extracted.title,
    unsettled: extracted.unsettled,
  }));

const base = {
  saveId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  baseVersion: count,
  input: TurnInputSchema,
  inputKey: z.string().min(1),
  updatedAt: z.iso.datetime(),
  prepared: PreparedSchema,
};

/** 当前版本的完整断点；阶段与已保存产物必须严格对应，不补旧结构或丢弃坏字段。 */
export const TurnCheckpointSchema: z.ZodType<TurnCheckpoint> = z
  .discriminatedUnion("stage", [
    z.strictObject({
      ...base,
      stage: z.literal("prepared"),
      narrated: z.undefined().optional(),
      extracted: z.undefined().optional(),
    }),
    z.strictObject({
      ...base,
      stage: z.literal("narrated"),
      narrated: NarratedSchema,
      extracted: z.undefined().optional(),
    }),
    z.strictObject({
      ...base,
      stage: z.literal("extracted"),
      narrated: NarratedSchema,
      extracted: ExtractedSchema,
    }),
  ])
  .superRefine((checkpoint, ctx) => {
    if (checkpoint.inputKey !== turnInputKey(checkpoint.input))
      ctx.addIssue({ code: "custom", path: ["inputKey"], message: "断点输入键与原始输入不一致" });
    const liveInput = checkpoint.prepared.sandevistanBoosted
      ? { ...checkpoint.input, sandevistan: true }
      : checkpoint.input;
    if (turnInputKey(checkpoint.prepared.liveInput) !== turnInputKey(liveInput))
      ctx.addIssue({
        code: "custom",
        path: ["prepared", "liveInput"],
        message: "已准备的行动与断点原始输入不一致",
      });
    if (checkpoint.prepared.sandevistanBoosted && !checkpoint.prepared.activeBoost)
      ctx.addIssue({
        code: "custom",
        path: ["prepared", "activeBoost"],
        message: "已启用加速但缺少对应设备",
      });
    if (checkpoint.stage === "extracted" && !checkpoint.prepared.ooc) {
      const plan = readEventPlan(checkpoint.extracted.shape.events);
      if (!plan.ok)
        ctx.addIssue({
          code: "custom",
          path: ["extracted", "shape", "events"],
          message: "已完成抽取的事件因果清单不符合当前结构",
        });
    }
  });
