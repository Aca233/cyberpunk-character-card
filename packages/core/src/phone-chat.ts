import type { Patch } from "immer";
import { z } from "zod";
import type {
  AbortSignalLike,
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmUsage,
  Rng,
} from "./kernel/ports";
import type { Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { responseJsonSchema, schemaDoc } from "./narrator/doc";
import { evaluatePhoneAvailability } from "./npc";
import { CharacterStateSchema } from "./systems/character/schema";
import { ChronicleStateSchema } from "./systems/chronicle";
import { CombatStateSchema } from "./systems/combat";
import { CyberwareStateSchema, ripperdocList } from "./systems/cyberware";
import { currentAttitude, FactionsStateSchema, factionCatalog } from "./systems/factions";
import { HealthStateSchema } from "./systems/health";
import { shopList } from "./systems/inventory";
import {
  fixerBlocked,
  isOpen,
  JOB_STATUS_LABELS,
  JobKindSchema,
  JobsStateSchema,
} from "./systems/jobs";
import { NemesisStateSchema } from "./systems/nemesis";
import {
  AFFINITY_SIZES,
  deathKnown,
  KNOWN_SOURCE_LABELS,
  LEDGER_KIND_LABELS,
  NO_FACTION,
  NO_FACTION_LABEL,
  type Npc,
  NpcStateSchema,
  onStage,
} from "./systems/npc";
import {
  CHAT_AFFINITY_SCENE_CAP,
  CHAT_SCENE_TURN_SOFT_CAP,
  hasContactChannel,
  type Message,
  PhoneStateSchema,
} from "./systems/phone";
import { registry } from "./systems/registry";
import {
  formatGameTime,
  locationCatalog,
  PERIOD_LABELS,
  periodOf,
  WorldClockStateSchema,
  withSavedPlaces,
} from "./systems/world";

/** 手机私聊单次请求体（POST /api/saves/:id/phone/chat） */
export const PhoneChatRequestSchema = z.strictObject({
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  baseVersion: z.number().int().min(0),
  contact: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1, "先写一句话再发出去").max(300, "私信每次最多 300 字"),
});
export type PhoneChatRequest = z.infer<typeof PhoneChatRequestSchema>;

const JobOfferPayloadSchema = z.object({
  title: z.string().trim().max(60),
  kind: JobKindSchema,
  client: z.string().trim().max(60),
  location: z.string().trim().max(60),
  risk: z.number().int().min(1).max(5),
  reward: z.number().int().min(0).max(20_000),
  dueMinutes: z.number().int().min(0).max(2880),
  conflict: z.string().trim().max(160),
  twist: z.string().trim().max(160),
});

/** 辅助模型返回的结构化手机私聊响应 */
export const PhoneChatLlmReplySchema = z.object({
  reply: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .describe("NPC 回复玩家的一句或几句短信原文，贴合说话方式，不写动作旁白"),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe(
      "消耗的游戏分钟数：寒暄闲聊写 1；认真交流/砍价/确认事写 2；详细约事、查情报或派单写 3",
    ),
  affinity: z
    .enum(["none", "upSmall", "downSmall", "downMedium"])
    .describe(
      "好感变动档位：闲聊、客套、常规砍价一律写 none；只有在玩家明显帮上忙、说对心坎或认真担事时写 upSmall（+2）；惹恼对方、踩底线或食言写 downSmall（-2）或 downMedium（-5）",
    ),
  affinityReason: z
    .string()
    .trim()
    .max(80)
    .describe("affinity 不为 none 时简述原因，否则写空字符串"),
  memory: z
    .string()
    .trim()
    .max(120)
    .describe("只在这轮记下了值得以后重提的承诺、人情或翻脸事时写一句，否则写空字符串"),
  job: z.object({
    action: z
      .enum(["none", "accept", "offer", "note", "abandon"])
      .describe(
        "委托动向：none 无变化；accept 答应接下待接的委托；offer 仅在上下文明确允许且顺理成章时挂出一单新委托；note 记一句进行中/待接委托的改约或备注；abandon 玩家主动明确推掉进行中委托。严禁在这里把任何委托标成完成/给钱",
      ),
    jobId: z
      .string()
      .trim()
      .max(80)
      .describe("accept / note / abandon 对应的委托 id；没有就写空字符串"),
    note: z
      .string()
      .trim()
      .max(120)
      .describe("job.action 为 note 时写记入笔记的一句，否则写空字符串"),
    summary: z
      .string()
      .trim()
      .max(120)
      .describe("job.action 为 abandon 时写一句话放弃说明，否则写空字符串"),
    offer: JobOfferPayloadSchema.nullable().describe(
      "仅当 job.action 为 offer 时填完整对象，其余时候写 null",
    ),
  }),
});
export type PhoneChatLlmReply = z.infer<typeof PhoneChatLlmReplySchema>;

export interface PhoneChatDeps {
  readonly llm: LlmClient;
  readonly rng: Rng;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  readonly purpose?: LlmRequest["purpose"] | undefined;
  readonly signal?: AbortSignalLike | undefined;
}

export type PhoneChatTargetCheck =
  | { readonly ok: true; readonly npc: Npc; readonly name: string }
  | { readonly ok: false; readonly reason: string };

export type PhoneChatResult =
  | {
      readonly ok: true;
      readonly world: WorldState;
      readonly commands: readonly Command[];
      readonly notes: readonly string[];
      readonly patches: readonly Patch[];
      readonly reply: string;
      readonly minutes: number;
      readonly usage?: LlmUsage;
    }
  | { readonly ok: false; readonly status: 409 | 502; readonly reason: string };

/** 在调用模型前校验眼下能不能和这个联系人发直聊 */
export function validatePhoneChatTarget(world: WorldState, contact: string): PhoneChatTargetCheck {
  const health = HealthStateSchema.parse(world.slices.health);
  if (health.condition === "dead") return { ok: false, reason: "已经死了，发不了消息" };

  const chronicle = ChronicleStateSchema.parse(world.slices.chronicle ?? {});
  if (chronicle.ended !== null) return { ok: false, reason: "故事已经收了尾，存档现在只读" };

  const combat = CombatStateSchema.parse(world.slices.combat);
  if (combat.active !== null) {
    return { ok: false, reason: "正在交火，先脱身或解决眼前这架再回消息" };
  }

  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const npc = npcs.npcs[contact];
  if (!npc) {
    return {
      ok: false,
      reason: "对方是没有建档的加密频道，暂不支持主动发起手机私聊",
    };
  }
  if (!hasContactChannel(phone, contact)) {
    return {
      ok: false,
      reason: `你还没有 ${npc.name} 的联系方式，先在剧情里互留频道再发私信`,
    };
  }
  if (!npc.alive) {
    return {
      ok: false,
      reason: deathKnown(npc)
        ? `${npc.name} 已经不在人世，消息发不过去`
        : "信号响了几声直接断线了，对面完全没有回音",
    };
  }
  return { ok: true, npc, name: npc.name };
}

function threadHistoryLines(messages: readonly Message[], contact: string): string[] {
  const relevant = messages.filter((m) => m.from === contact).slice(-12);
  const lines: string[] = [];
  for (const m of relevant) {
    if (m.sender === "player") {
      lines.push(`[${formatGameTime(m.at)}] 玩家 -> 对方：${m.text}`);
      continue;
    }
    const jobTag = m.job ? ` [附带委托 ${m.job}]` : "";
    lines.push(`[${formatGameTime(m.at)}] ${m.name}${jobTag}：${m.text}`);
    if (m.reply) {
      lines.push(`[${formatGameTime(m.repliedAt ?? m.at)}] 玩家回复：${m.reply}`);
    }
  }
  return lines;
}

const PHONE_CHAT_EXAMPLE = JSON.stringify({
  reply: "晚上十点老地方碰头，别带尾巴。",
  minutes: 2,
  affinity: "none",
  affinityReason: "",
  memory: "",
  job: { action: "none", jobId: "", note: "", summary: "", offer: null },
});

let cachedPhoneChatOutput: string | null = null;
function phoneChatOutput(): string {
  cachedPhoneChatOutput ??= `【输出格式】\n只输出一个 JSON 对象，不要解释，不要 markdown 代码块。所有字段都要写。\n${schemaDoc(PhoneChatLlmReplySchema)}\n例：\n${PHONE_CHAT_EXAMPLE}`;
  return cachedPhoneChatOutput;
}

let cachedPhoneChatSystem: string | null = null;
function phoneChatSystem(): string {
  cachedPhoneChatSystem ??= [
    "你在扮演《赛博朋克 2077》夜之城里一位有血有肉的人物，正在用加密短讯回复玩家。",
    "核心规则：",
    "1. 口吻完全照人物卡的说话方式与台词样本，像手机短信：短、利落、带人味和当下处境；不要写长篇大论，不要替玩家做行动或代写旁白。",
    "2. 如果玩家在手机里试图遥控打架、过检定、远程潜入/黑入、直接隔空买装备/装义体，或要求立刻把正在进行的委托当场结清收钱：在口吻里自然回绝（让对方到现场或走正事见面解决），job.action 一律写 none，绝不发放任何金钱或物品。",
    "3. 严禁通过闲聊轻易刷好感：纯客套、打招呼、常规砍价写 none；只有真正说到心坎、切实替对方分忧、或担下重要承诺才写 upSmall（最多 +2）；踩到底线、挑衅、敷衍或食言写 downSmall / downMedium。",
    "4. 委托控制与对话节奏须严格遵守用户消息里的【本条对话约束】。",
    phoneChatOutput(),
  ].join("\n");
  return cachedPhoneChatSystem;
}

/** 构造发给辅助模型的极简双人私聊上下文 */
export function buildPhoneChatPrompt(
  world: WorldState,
  npc: Npc,
  playerText: string,
  data: Readonly<Record<string, unknown>> = {},
): {
  readonly messages: LlmMessage[];
  readonly canOfferJob: boolean;
  readonly isFixer: boolean;
  readonly isFixerBlocked: boolean;
  readonly activeNemesis: boolean;
  readonly remainingAffinityBudget: number;
  readonly scene: number;
} {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const character = CharacterStateSchema.parse(world.slices.character);
  const phoneState = PhoneStateSchema.parse(world.slices.phone ?? {});
  const jobsState = JobsStateSchema.parse(world.slices.jobs);
  const nemeses = NemesisStateSchema.parse(world.slices.nemesis ?? {});
  const factions = FactionsStateSchema.parse(world.slices.factions ?? {});
  const debts = CyberwareStateSchema.parse(world.slices.cyberware ?? {}).debts;
  const catalog = factionCatalog(data);
  const places = locationCatalog(withSavedPlaces(data, world));
  const placeName = (id: string | null) => (id ? (places.get(id)?.name ?? id) : "未知地点");

  const scene = clock.scene;
  const prevBudget = phoneState.chatBudget[npc.id];
  const sceneTurns = prevBudget?.scene === scene ? prevBudget.turns : 0;
  const gained = prevBudget?.scene === scene ? prevBudget.affinityGained : 0;
  const remainingAffinityBudget = Math.max(0, CHAT_AFFINITY_SCENE_CAP - gained);
  const jobOfferedThisScene = prevBudget?.scene === scene ? prevBudget.jobOffered : false;

  const isFixer = Boolean(jobsState.fixers[npc.id]);
  const factionDef = npc.faction === NO_FACTION ? undefined : catalog.get(npc.faction);
  const factionAttitude = factionDef ? currentAttitude(factions, factionDef) : undefined;
  const isFixerBlocked = fixerBlocked(factionAttitude);
  const activeNemesis = nemeses.nemeses.some((n) => n.npc === npc.id);

  const relatedJobs = jobsState.jobs.filter(
    (j) => isOpen(j) && (j.fixer === npc.id || j.asker === npc.id || j.client === npc.name),
  );
  const hasOpenJobFromContact = relatedJobs.length > 0;
  const canOfferJob =
    !activeNemesis &&
    !isFixerBlocked &&
    !jobOfferedThisScene &&
    !hasOpenJobFromContact &&
    (isFixer || npc.affinity >= 0);

  const here =
    npc.met && onStage(npc, { location: clock.location, sceneStartedAt: clock.sceneStartedAt });
  const phoneStatus = evaluatePhoneAvailability(npc, world.time);
  const doc = ripperdocList(data).find((d) => d.keeperNpc === npc.id);
  const ownedShops = shopList(data).filter((s) => s.keeperNpc === npc.id);
  const docDebts = doc ? debts.filter((d) => d.doc === doc.id) : [];

  const urgentLines: string[] = [];
  for (const d of clock.deadlines) {
    if (d.handledAt !== null) continue;
    const left = d.due - world.time;
    if (left > 0 && left <= 15) urgentLines.push(`约定时限「${d.label}」还剩 ${left} 分钟`);
  }
  for (const j of jobsState.jobs) {
    if (isOpen(j) && j.due !== null) {
      const left = j.due - world.time;
      if (left > 0 && left <= 15) urgentLines.push(`委托「${j.title}」截止还剩 ${left} 分钟`);
    }
  }

  // 系统层保持纯静态以命中跨轮/跨联系人提示词缓存；动态委托权限与场景轮次约束放进用户消息
  const system = phoneChatSystem();
  const dynamicRules = [
    `委托控制：${
      canOfferJob
        ? '如果玩家明确在找活、问门路、求委托，且符合你的身份与双方交情，可以通过 job.action="offer" 挂出一单合乎夜之城体量与你的行当的新委托（不设就写 none，别硬塞）'
        : activeNemesis || isFixerBlocked
          ? "对方当前与你处于敌对或拉黑/宿敌状态：不要给好感加成，不要派新活"
          : "当前不允许额外派发新委托（已有进行中委托、本场刚派过或交情不足）；如需接下待接的旧委托，可用 accept；更新进展记 note；玩家明确弃单可用 abandon"
    }。`,
    sceneTurns >= CHAT_SCENE_TURN_SOFT_CAP
      ? `对话节奏：你们在这个场景已经发了 ${sceneTurns} 轮短信了，顺手找个自然的借口或句点收尾（有事当面碰、忙手上活去），别没完没了拉扯。`
      : here
        ? "对话节奏：对方此时此刻就在你同一地点附近，简短几字回应即可，顺势让双方回到现场面对面聊。"
        : "对话节奏：时间照实际来回取 1–3 分钟，干脆收住回复。",
  ].join("\n");

  const cardLines = [
    `【目标人物】${npc.name}${npc.alias ? `（外号：${npc.alias}）` : ""} · ${npc.pronoun} · ${npc.role}`,
    !npc.met
      ? "照面状态：你们尚未当面见过，仅通过全息通讯联络（不要写成已经见过面或描写当面外貌细节）"
      : "",
    `势力：${factionDef ? `${factionDef.name}（态度：${factionAttitude}）` : NO_FACTION_LABEL}`,
    `好感度：${npc.affinity}${npc.relation ? `｜关系笔记：${npc.relation.text}` : ""}`,
    `性格口吻：${npc.voice}`,
    npc.samples.length > 0 ? `台词参考：${npc.samples.join(" / ")}` : "",
    `诉求：${npc.want}`,
    `底线：${npc.limit}`,
    npc.secret ? `秘密（暗中把握，别直接抖露）：${npc.secret}` : "",
    npc.doing ? `眼下近况：${npc.doing.text}` : "",
    doc
      ? `服务身份：义体医生（${doc.name}）${docDebts.length ? `，玩家欠款：${docDebts.map((d) => `${d.amount} 欧元（${d.due === null ? "未约定期限" : `期限 ${formatGameTime(d.due)}`}）`).join("；")}` : ""}`
      : "",
    ownedShops.length > 0
      ? `服务身份：经营店铺（${ownedShops.map((s) => s.name).join("、")}）`
      : "",
    npc.following ? "当前状态：正与玩家结伴同行" : "",
    npc.memories.length > 0
      ? `共同记忆：\n${npc.memories
          .slice(-6)
          .map((m) => `- ${m}`)
          .join("\n")}`
      : "",
    npc.ledger.filter((e) => e.settledAt === null).length > 0
      ? `未结人情与仇：\n${npc.ledger
          .filter((e) => e.settledAt === null)
          .map((e) => `- ${LEDGER_KIND_LABELS[e.kind]}：${e.text}`)
          .join("\n")}`
      : "",
    npc.known.length > 0
      ? `玩家已知信息：\n${npc.known
          .slice(-4)
          .map((k) => `- ${k.text}（${KNOWN_SOURCE_LABELS[k.source]}）`)
          .join("\n")}`
      : "",
    relatedJobs.length > 0
      ? `双方关联的未结委托：\n${relatedJobs
          .map(
            (j) =>
              `- [${j.id}] ${j.title}｜状态：${JOB_STATUS_LABELS[j.status]}｜报酬：${j.reward}｜雇主：${j.client}${j.due !== null ? `｜截止：${formatGameTime(j.due)}` : ""}${j.notes.length > 0 ? `｜笔记：${j.notes.slice(-2).join("；")}` : ""}`,
          )
          .join("\n")}`
      : "",
    `【当前状态】时间：${formatGameTime(world.time)}（${PERIOD_LABELS[periodOf(world.time)]}）｜玩家所在：${placeName(clock.location)}｜是否同一场景在场：${here ? "是" : "否"}`,
    `玩家名：${character.name ?? "匿名佣兵"}｜本场对 TA 正向好感剩余可用额度：+${remainingAffinityBudget}（每场封顶 +${CHAT_AFFINITY_SCENE_CAP}）`,
    !phoneStatus.answered && phoneStatus.reason ? `作息/忙碌提示：${phoneStatus.reason}` : "",
    urgentLines.length > 0 ? `紧急时限提醒：${urgentLines.join("；")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const history = threadHistoryLines(phoneState.messages, npc.id);
  const user = [
    `【本条对话约束】\n${dynamicRules}`,
    cardLines,
    history.length > 0
      ? `【近期短信往来】\n${history.join("\n")}`
      : "【近期短信往来】\n（暂无历史短信）",
    `【玩家刚才发来】\n${playerText}`,
  ].join("\n\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    canOfferJob,
    isFixer,
    isFixerBlocked,
    activeNemesis,
    remainingAffinityBudget,
    scene,
  };
}

/** 从模型输出里安全取出 JSON 并校验字段 */
function clipText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

function normalizeBoundedInt(raw: unknown, min: number, max: number, fallback?: number): unknown {
  if (raw === undefined || raw === null || raw === "") {
    return fallback !== undefined ? fallback : raw;
  }
  const num =
    typeof raw === "string" && /^-?\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof num === "number" && Number.isFinite(num)) {
    return Math.min(max, Math.max(min, Math.round(num)));
  }
  return raw;
}

function normalizeJobOffer(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const rec = raw as Record<string, unknown>;
  return {
    title: clipText(rec.title, 60),
    kind: rec.kind,
    client: clipText(rec.client, 60),
    location: clipText(rec.location, 60),
    risk: normalizeBoundedInt(rec.risk, 1, 5),
    reward: normalizeBoundedInt(rec.reward, 0, 20_000),
    dueMinutes: normalizeBoundedInt(rec.dueMinutes, 0, 2880),
    conflict: clipText(rec.conflict, 160),
    twist: clipText(rec.twist, 160),
  };
}

export function parsePhoneChatReply(
  rawText: string,
):
  | { readonly ok: true; readonly data: PhoneChatLlmReply }
  | { readonly ok: false; readonly reason: string } {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, reason: "对方信号乱码（模型回复里没有合法 JSON），消息未发送" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "对方信号乱码（JSON 解析失败），消息未发送" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "模型返回的私信格式不对，请重发" };
  }
  const rec = raw as Record<string, unknown>;
  const rawJob =
    typeof rec.job === "object" && rec.job !== null && !Array.isArray(rec.job)
      ? (rec.job as Record<string, unknown>)
      : {};
  const action =
    rawJob.action === undefined || rawJob.action === null || rawJob.action === ""
      ? "none"
      : rawJob.action;
  const normalized = {
    reply: typeof rec.reply === "string" ? clipText(rec.reply, 240) : rec.reply,
    minutes: normalizeBoundedInt(rec.minutes, 1, 3, 1),
    affinity:
      rec.affinity === undefined || rec.affinity === null || rec.affinity === ""
        ? "none"
        : rec.affinity,
    affinityReason: clipText(rec.affinityReason, 80),
    memory: clipText(rec.memory, 120),
    job: {
      action,
      jobId: clipText(rawJob.jobId, 80),
      note: clipText(rawJob.note, 120),
      summary: clipText(rawJob.summary, 120),
      offer: action === "offer" ? normalizeJobOffer(rawJob.offer) : null,
    },
  };
  const parsed = PhoneChatLlmReplySchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, reason: "对方信号太弱（回复格式不完整），请重试一次" };
  }
  return { ok: true, data: parsed.data };
}

function resolveJobForContact(
  jobs: ReturnType<typeof JobsStateSchema.parse>["jobs"],
  npc: Npc,
  jobId: string,
  status?: "offered" | "active",
) {
  const matchContact = (j: (typeof jobs)[number]) =>
    isOpen(j) && (j.fixer === npc.id || j.asker === npc.id || j.client === npc.name);
  if (jobId !== "") {
    const exact = jobs.find((j) => j.id === jobId);
    if (exact && matchContact(exact) && (status === undefined || exact.status === status)) {
      return exact;
    }
  }
  const candidates = jobs.filter(
    (j) => matchContact(j) && (status === undefined || j.status === status),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** 轻量手机直聊主流程：校验对象 -> 辅助模型生成短信与微调意图 -> 代码硬规则截断并按 3 步原子记账推进时间 */
export async function runPhoneChat(
  deps: PhoneChatDeps,
  world: WorldState,
  contact: string,
  rawText: string,
): Promise<PhoneChatResult> {
  const text = rawText.trim().slice(0, 300);
  if (text === "") return { ok: false, status: 409, reason: "先写一句话再发出去" };

  const target = validatePhoneChatTarget(world, contact);
  if (!target.ok) return { ok: false, status: 409, reason: target.reason };
  const { npc } = target;

  const ctx = buildPhoneChatPrompt(world, npc, text, deps.data);
  let llmText = "";
  let usage: LlmUsage | undefined;
  let blockedReason: string | undefined;
  for await (const event of deps.llm.stream(
    {
      purpose: deps.purpose ?? "aux",
      messages: ctx.messages,
      maxOutputTokens: 2048,
      temperature: 0.5,
      responseFormat: responseJsonSchema("phoneChat", PhoneChatLlmReplySchema),
    },
    deps.signal,
  )) {
    if (event.type === "text") llmText += event.text;
    else if (event.type === "blocked") blockedReason = event.reason;
    else if (event.type === "done") usage = event.usage;
  }

  if (blockedReason !== undefined) {
    return { ok: false, status: 502, reason: `模型拒绝了这段对话：${blockedReason}` };
  }
  const parsed = parsePhoneChatReply(llmText);
  if (!parsed.ok) return { ok: false, status: 502, reason: parsed.reason };

  const reply = parsed.data;
  const applyCtx = { rng: deps.rng, ...(deps.data ? { data: deps.data } : {}) };
  const jobsBefore = JobsStateSchema.parse(world.slices.jobs);
  const phoneBefore = PhoneStateSchema.parse(world.slices.phone ?? {});

  let minutes = Math.max(1, Math.min(3, Math.round(reply.minutes)));
  const step1Commands: Command[] = [{ type: "phone.send", to: npc.id, text }];

  if (reply.job.action === "accept") {
    const job = resolveJobForContact(jobsBefore.jobs, npc, reply.job.jobId, "offered");
    if (job && (job.due === null || job.due > world.time)) {
      step1Commands.push({ type: "jobAccept", id: job.id });
      minutes = Math.max(minutes, 2);
    }
  } else if (reply.job.action === "note" && reply.job.note !== "") {
    const job = resolveJobForContact(jobsBefore.jobs, npc, reply.job.jobId);
    if (job) {
      step1Commands.push({ type: "jobNote", id: job.id, note: reply.job.note });
    }
  } else if (reply.job.action === "abandon") {
    const job = resolveJobForContact(jobsBefore.jobs, npc, reply.job.jobId, "active");
    if (job) {
      step1Commands.push({
        type: "jobEnd",
        id: job.id,
        outcome: "abandoned",
        summary: reply.job.summary || "玩家通过私信提前告知放弃这单委托",
      });
    }
  }

  const willOffer =
    reply.job.action === "offer" &&
    ctx.canOfferJob &&
    reply.job.offer !== null &&
    reply.job.offer.title !== "" &&
    reply.job.offer.conflict !== "";
  if (willOffer) minutes = Math.max(minutes, 2);

  // 第 1 步：记下玩家发送的私信及（若成立）即时响应现有委托状态变化
  const step1 = registry.applyCommands(world, step1Commands, applyCtx);
  const commands: Command[] = [];
  const notes: string[] = [];
  for (const { command, result } of step1.results) {
    if (!result.ok) {
      if (command.type === "phone.send") {
        return { ok: false, status: 409, reason: result.reason };
      }
      continue;
    }
    commands.push(command);
    notes.push(...result.notes);
  }

  // 第 2 步：推进 1–3 分钟游戏时钟与定时结算（不结束场景、不触发累了/疲惫计数）
  const step2 = registry.advanceTo(step1.world, world.time + minutes, applyCtx);
  const afterNow = step2.world.time;

  // 第 3 步：在回复时刻落盘新挂出的委托、受控好感变化、共同记忆、对方短信与本场私聊预算
  let offeredJobId: string | undefined;
  const offerCommands: Command[] = [];
  if (willOffer && reply.job.offer) {
    const o = reply.job.offer;
    const baseId = `chat-${npc.id}-${ctx.scene}-${world.time}-${phoneBefore.nextId}`;
    const existingIds = new Set(
      JobsStateSchema.parse(step2.world.slices.jobs).jobs.map((j) => j.id),
    );
    if (!existingIds.has(baseId)) {
      offeredJobId = baseId;
      const dueStr =
        o.dueMinutes > 0 ? formatGameTime(afterNow + Math.max(15, o.dueMinutes)) : undefined;
      offerCommands.push({
        type: "jobOffer",
        id: baseId,
        title: o.title,
        kind: o.kind,
        ...(ctx.isFixer ? { fixer: npc.id } : { asker: npc.id }),
        client: o.client || "匿名委托人",
        ...(o.location !== "" ? { location: o.location } : {}),
        risk: o.risk,
        reward: o.reward,
        ...(dueStr ? { due: dueStr } : {}),
        conflict: o.conflict,
        ...(o.twist !== "" ? { twist: o.twist } : {}),
      });
    }
  }

  let world3 = step2.world;
  const patches3: Patch[] = [];
  let jobOfferedOk = false;
  if (offerCommands.length > 0 && offeredJobId) {
    const offerApplied = registry.applyCommands(world3, offerCommands, applyCtx);
    const first = offerApplied.results[0];
    if (first?.result.ok) {
      world3 = offerApplied.world;
      patches3.push(...offerApplied.patches);
      commands.push(first.command);
      notes.push(...first.result.notes);
      jobOfferedOk = true;
    } else {
      offeredJobId = undefined;
    }
  }

  let affinityDelta = 0;
  let affinityGained = 0;
  if (reply.affinity === "upSmall") {
    if (!ctx.activeNemesis && !ctx.isFixerBlocked && ctx.remainingAffinityBudget > 0) {
      affinityDelta = Math.min(AFFINITY_SIZES.small, ctx.remainingAffinityBudget);
      affinityGained = affinityDelta;
    }
  } else if (reply.affinity === "downSmall") {
    affinityDelta = -AFFINITY_SIZES.small;
  } else if (reply.affinity === "downMedium") {
    affinityDelta = -AFFINITY_SIZES.medium;
  }

  const tailCommands: Command[] = [];
  if (affinityDelta !== 0) {
    tailCommands.push({
      type: "affinity",
      id: npc.id,
      delta: affinityDelta,
      reason: reply.affinityReason || "手机私信交谈",
      channel: "phone",
    });
  }
  if (reply.memory !== "") {
    tailCommands.push({ type: "memory", id: npc.id, text: reply.memory, source: "phone" });
  }
  tailCommands.push({
    type: "phone.receive",
    from: npc.id,
    text: reply.reply,
    ...(jobOfferedOk && offeredJobId ? { job: offeredJobId } : {}),
  });
  tailCommands.push({
    type: "phone.chatMeta",
    npc: npc.id,
    scene: ctx.scene,
    ...(affinityGained > 0 ? { affinityGained } : {}),
    ...(jobOfferedOk ? { jobOffered: true } : {}),
  });

  const step3 = registry.applyCommands(world3, tailCommands, applyCtx);
  for (const { command, result } of step3.results) {
    if (!result.ok) continue;
    commands.push(command);
    notes.push(...result.notes);
  }

  return {
    ok: true,
    world: step3.world,
    commands,
    notes,
    patches: [...step1.patches, ...step2.patches, ...patches3, ...step3.patches],
    reply: reply.reply,
    minutes,
    ...(usage ? { usage } : {}),
  };
}
