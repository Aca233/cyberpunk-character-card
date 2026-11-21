import { z } from "zod";
import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { ArcsStateSchema, arcOffscreenSection, ConcernFateSchema } from "../systems/arcs";
import { CRED_SIZES } from "../systems/character";
import {
  BULLETIN_MAX,
  BulletinKindSchema,
  CityStateSchema,
  CityStatusSchema,
  CityWeightSchema,
  OFFSCREEN_EVENTS,
  OFFSCREEN_MAJOR,
  OFFSCREEN_RUMORS,
  RumorReachSchema,
  RumorTruthSchema,
  rumorSection,
} from "../systems/city";
import { agendaCatalog, TurfChangeSchema } from "../systems/factions";
import { InventoryStateSchema, itemCatalog } from "../systems/inventory";
import { JobsStateSchema } from "../systems/jobs";
import { NpcStateSchema } from "../systems/npc";
import {
  THREAD_DAYS_MAX,
  THREAD_DAYS_MIN,
  THREAD_KIND_LABELS,
  THREAD_NEWS_MAX,
  THREAD_STAGE_MAX,
  THREAD_TEXT_MAX,
  THREAD_TITLE_MAX,
  THREAD_WANT_MAX,
  THREADS_MAX,
  ThreadKindSchema,
  ThreadsStateSchema,
} from "../systems/threads";
import { TravelStateSchema, vehicleCatalog } from "../systems/travel";
import {
  formatGameTime,
  locationCatalog,
  WorldClockStateSchema,
  withSavedPlaces,
} from "../systems/world";
import { parseModelJson } from "./block";
import { canonSection } from "./canon";
import {
  OFFSCREEN_MERCHANT_OUTPUT,
  OFFSCREEN_MERCHANT_RULE,
  type OffscreenEventSummary,
  offscreenMerchantContext,
  readOffscreenMerchantChanges,
} from "./offscreen-merchants";
import {
  fitOffscreenBatch,
  type OffscreenBatch,
  type OffscreenCapacity,
  type OffscreenPromptScope,
  pendingTurns,
} from "./offscreen-trigger";
import { type PromptExtras, stateSummary } from "./prompts/context";
import { BOOKKEEPING_BASE, userMessage } from "./prompts/layers";

const SOFT_CAP = 3;
const soft = (n: number) => n * SOFT_CAP;

/** 原生 JSON Schema 约束：扁平清晰，适配各主流模型供应商 */
const MacroRumorSchema = z.object({
  text: z.string().trim().min(1).max(80),
  truth: RumorTruthSchema,
  reach: RumorReachSchema,
  district: z.string().trim().min(1).max(20).nullable().optional(),
  player: z.boolean().optional(),
});

const MacroSituationSchema = z.object({
  op: z.enum(["open", "step", "defer", "close"]),
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id 用小写英文、数字和连字符，最长 40"),
  kind: ThreadKindSchema.optional(),
  owner: z.string().trim().min(1).nullable().optional(),
  seed: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(THREAD_TITLE_MAX).optional(),
  district: z.string().trim().min(1).max(20).nullable().optional(),
  weight: CityWeightSchema.optional(),
  status: CityStatusSchema.optional(),
  want: z.string().trim().min(1).max(THREAD_WANT_MAX).optional(),
  stage: z.string().trim().min(1).max(THREAD_STAGE_MAX).optional(),
  truth: z.string().trim().min(1).max(THREAD_TEXT_MAX).optional(),
  publicText: z.string().trim().min(1).max(THREAD_NEWS_MAX).optional(),
  days: z.number().int().min(THREAD_DAYS_MIN).max(THREAD_DAYS_MAX).optional(),
  why: z.string().trim().min(1).max(THREAD_NEWS_MAX).optional(),
  turf: TurfChangeSchema.nullable().optional(),
  playerCred: z.enum(["small", "medium", "large"]).nullable().optional(),
  fate: ConcernFateSchema.nullable().optional(),
  rumors: z.array(MacroRumorSchema).optional(),
});

const MacroBulletinSchema = z.object({
  kind: BulletinKindSchema,
  title: z.string().trim().min(1).max(24),
  text: z.string().trim().min(1).max(BULLETIN_MAX),
  situationIds: z.array(z.string().trim().min(1)).optional(),
});

const MacroMerchantChangeSchema = z.object({
  type: z.enum(["shopBusiness", "cyberware.clinic", "logistics.route"]),
  shop: z.string().min(1).nullable().optional(),
  doc: z.string().min(1).nullable().optional(),
  location: z.string().min(1).nullable().optional(),
  action: z.enum(["open", "close", "staff"]).nullable().optional(),
  open: z.boolean().nullable().optional(),
  blocked: z.boolean().nullable().optional(),
  keeperNpc: z.string().min(1).nullable().optional(),
  serviceNpcs: z.array(z.string().min(1)).nullable().optional(),
  staff: z.array(z.string().min(1)).nullable().optional(),
  equipment: z.array(z.string().min(1)).nullable().optional(),
  reason: z.string().min(1),
  evidence: z.string().min(2),
  sourceEvent: z.string().min(1),
});

export const MacroOffscreenDocSchema = z.object({
  situations: z.array(MacroSituationSchema),
  standaloneRumors: z.array(MacroRumorSchema).optional(),
  bulletin: MacroBulletinSchema.nullable().optional(),
  merchantChanges: z.array(MacroMerchantChangeSchema).optional(),
});

const MACRO_STAGE = `【这一步：宏观世界局势推演】
你只负责推演夜之城的宏观局势、势力暗流、街头传闻、新闻/电台快讯与受波及商家的经营变化；人物日常私生活、人际关系与发短信派单由另一独立通道负责，本步不写人物私信或 NPC 近况。
- 【上次成功推演后的正文】是尚未处理的新事实，当前状态是本轮结算后的事实。沿着已有因果推进，不重复制造已处理的事，不凭空制造戏剧性；没有值得记的变化时 situations 输出 []、bulletin 写 null。
- 不改玩家状态数值或账目（欧元、人性、伤势、好感、通缉热度；仅玩家当事的 major 头条局势写 playerCred 由代码记一次街头声望）；不写玩家做了什么、说了什么、想了什么。
- 【城中局势】把四类事统一在一张单子上（最多 ${THREADS_MAX} 件，不必填满）：
  - civic：城中突发事件、帮派摩擦、公司动作、玩家行动留下的余波（owner 写 null）；
  - faction：势力的系统性扩张与打算（owner 写势力 id，可照【势力打算素材】填 seed）；
  - nemesis：宿敌在屏幕外的报复布局（宿敌刚出现时代码自动开立，不用另开；只写幕后布局，不让他直接出现在玩家眼前）；
  - concern：人物心事的场外推进（owner 写人物 id，seed 写心事 id；心事素材只是潜在条件，必须有本批正文或已记录事实支持触发前因才可 open，不能凭好感或原作结局补发生）。
- 标「已到点」的局势，本批在 situations 里写一条 op: "step"（推进）、"defer"（局面未熟延期）或 "close"（收场）；没到点但因本批新事实激化也可提前推一步；每件局势本批最多写一条操作。
- 每次建议推进不超过 ${OFFSCREEN_EVENTS} 件局势，major 头条建议最多 ${OFFSCREEN_MAJOR} 件（超额降为 normal）。
- 地盘：只有 kind 为 faction 的 step 能动地盘（turf），一步最多一个城区（照种子开的只在「能争的城区」内），改的是该势力或其对头；不动写 null。
- 街头传闻：某局势产生值得街上传开的风声时，直接写在该局势的 rumors 数组里（0–2 条）；零星不挂靠局势的传闻写 standaloneRumors。truth 标属实/夸大/走样（true/exaggerated/garbled），reach 标 street/district/city；说的是玩家时标 player: true（只按街上人看到的写，不编玩家没做过的大事）。
- 2077 背景时间线只是无人插手时的参考大势：若本局已有冲突事实（关键人物生死、阵营变化、玩家改写），一律以本局事实改写或跳过，绝不硬拉回原作；采纳或改写为本局事态时，通过 situations 与 bulletin 真实落地。
- 节日与周年纪念：仅按游戏日期与已建立前因判断，不凭历史日历自动制造全城节庆；荒坂三郎追悼游行等剧情节点仅在当前事实支持时出现。
- 新闻/电台快讯（bulletin）：主流媒体（N54/WNS，kind: news）按公司与赞助方立场报道；地下电台（kind: radio）写明台名与民间视角，但只说播出者有依据知道的内容，绝不泄露幕后秘密。本批写了 major 局势时应写一段快讯；其余时候有值得播的才写，否则写 null。若快讯确实播报了本批 step 推进或尚有未公开进展的局势，在 situationIds 里写它们的 id（仅 open 或 defer 的局势没有公开进展，不要写进 situationIds）。`;

const MACRO_OUTPUT = `【输出格式】
只输出一个 JSON 对象，不要代码块。situations 必须是数组（无变化写 []）：
- open：{"op":"open","id":"小写英文连字符","kind":"civic|faction|nemesis|concern","owner":"势力或人物id，civic写null","seed":"种子id或null","title":"24字以内","district":"城区或null","weight":"minor|normal|major","status":"brewing|heating|cooling","want":"120字以内目标/核心矛盾","stage":"80字以内当前阶段","truth":"可选：160字以内已发生事实摘要","days":3,"playerCred":"可省：玩家当事头条写small|medium|large","rumors":[...]}
- step：{"op":"step","id":"已有局势id","truth":"160字以内实际发生了什么（幕后真相）","publicText":"80字以内传开后的公开说法","stage":"可选：更新当前阶段","district":"可选","weight":"可选","status":"可选：brewing|heating|cooling","turf":null,"days":3,"playerCred":"可省","rumors":[...]}
- defer：{"op":"defer","id":"已有局势id","days":3,"why":"80字以内延期理由"}
- close：{"op":"close","id":"已有局势id","truth":"160字以内实际结局","fate":"心事收场写better|canon|worse，其余省略","rumors":[...]}
- standaloneRumors：[{"text":"80字以内传闻原话","truth":"true|exaggerated|garbled","reach":"street|district|city","district":"reach非city时写城区","player":false}]
- bulletin：{"kind":"news|radio","title":"24字以内","text":"200字以内播报原文","situationIds":["已播报进展的局势id"]} 或 null`;

export const MACRO_OFFSCREEN_SYSTEM = [
  BOOKKEEPING_BASE,
  MACRO_STAGE,
  OFFSCREEN_MERCHANT_RULE,
  MACRO_OUTPUT,
  OFFSCREEN_MERCHANT_OUTPUT,
].join("\n\n");

export function buildMacroOffscreenPrompt(
  world: WorldState,
  records: readonly LogRecord[],
  extras: PromptExtras,
  narrative: string,
  scope?: OffscreenPromptScope,
): LlmMessage[] {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  const cursor = city.macro;
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const roster = NpcStateSchema.parse(world.slices.npc).npcs;
  const threads = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const pending = pendingTurns(world, records, cursor.processedThrough).filter(
    (record) => scope === undefined || record.seq <= scope.through,
  );
  const jobs = JobsStateSchema.parse(world.slices.jobs).jobs.filter(
    (j) =>
      ["active", "offered", "expired"].includes(j.status) ||
      (j.closedAt !== null && (cursor.lastAt === null || j.closedAt >= cursor.lastAt)),
  );
  const changes = [
    narrative,
    ...pending.map((r) => `${r.text}\n${JSON.stringify(r.commands)}`),
    ...threads.threads.map(
      (t) =>
        `${t.owner ?? ""} ${t.title} ${t.want} ${t.stage} ${t.steps.map((s) => s.text).join(" ")}`,
    ),
    ...jobs.map((j) => `${j.fixer ?? ""} ${j.asker ?? ""} ${j.client} ${j.conflict}`),
  ].join("\n");

  const relevantNpcIds = new Set<string>();
  const mentionedIds = new Set(changes.match(/[a-zA-Z0-9][a-zA-Z0-9:_-]*/g) ?? []);
  for (const n of Object.values(roster)) {
    if (mentionedIds.has(n.id) || changes.includes(n.name)) relevantNpcIds.add(n.id);
  }
  const concerns = arcOffscreenSection(
    ArcsStateSchema.parse(world.slices.arcs ?? {}),
    extras.data ?? {},
    new Set([...relevantNpcIds].filter((id) => roster[id]?.alive)),
  );

  const places = locationCatalog(withSavedPlaces(extras.data ?? {}, world));
  const district = clock.location === null ? undefined : places.get(clock.location)?.district;
  const factions = new Set(
    [...relevantNpcIds].map((id) => roster[id]?.faction).filter((f): f is string => Boolean(f)),
  );
  for (const t of threads.threads) {
    if (t.kind === "faction" && t.owner) factions.add(t.owner);
  }
  const seeds = [...agendaCatalog(extras.data ?? {}).values()];
  const selectedSeeds = new Set(
    seeds
      .filter(
        (s) =>
          threads.threads.some((t) => t.seed === s.id) ||
          factions.has(s.faction) ||
          (district !== undefined && s.districts.includes(district)) ||
          changes.includes(s.faction),
      )
      .map((s) => s.id),
  );
  const distantSeeds = seeds.filter((s) => !selectedSeeds.has(s.id));
  if (distantSeeds.length > 0 && !scope?.backlog) {
    const offset = Math.max(0, cursor.processedThrough + 1) % distantSeeds.length;
    for (let i = 0; i < Math.min(2, distantSeeds.length); i += 1) {
      const seed = distantSeeds[(offset + i) % distantSeeds.length];
      if (seed) selectedSeeds.add(seed.id);
    }
  }

  const due = [
    `当前 ${threads.threads.length}/${THREADS_MAX} 件；有空位且有前因才开新事，不必填满。`,
    ...threads.threads.map(
      (t) =>
        `- ${t.id}｜${THREAD_KIND_LABELS[t.kind]}·${t.title}｜城区：${t.district ?? "全城"}｜状态：${t.status}｜量级：${t.weight}｜主人：${t.owner ?? "无"}｜种子：${t.seed ?? "无"}｜想要：${t.want}｜眼下：${t.stage}｜下次推进：${formatGameTime(t.dueAt)}（${t.dueAt <= world.time ? "已到点" : "还没到点"}${t.reminded ? "，上次推演未处理" : ""}）${
          t.steps.length
            ? `\n  最近：${t.steps
                .slice(-2)
                .map(
                  (s) =>
                    `${formatGameTime(s.at)} ${s.kind === "move" ? "" : "玩家插手："}${s.text}；公开说法：${s.news}（${s.told ? "玩家已听说" : "玩家尚未听说"}）`,
                )
                .join("；")}`
            : ""
        }`,
    ),
    ...threads.closed.slice(-4).map((t) => `- ${t.id}｜已收场·${t.title}：${t.end}`),
  ].join("\n");

  const footprintLines: string[] = [];
  const travel = TravelStateSchema.parse(world.slices.travel);
  const inv = InventoryStateSchema.parse(world.slices.inventory);
  const cars = vehicleCatalog(extras.data ?? {});
  const items = extras.data?.items !== undefined ? itemCatalog(extras.data) : new Map();
  for (const v of travel.vehicles) {
    if (!v.abandoned && !v.stolen && v.condition === "intact") continue;
    const vname = cars.get(v.model)?.name ?? v.model;
    const loc = v.location ? (places.get(v.location)?.name ?? v.location) : "位置未知";
    const tags = [
      v.abandoned ? "已弃置" : null,
      v.stolen ? "偷来的" : null,
      v.condition !== "intact" ? v.condition : null,
    ]
      .filter((x): x is string => x !== null)
      .join("、");
    footprintLines.push(`- 车辆 ${v.id}「${vname}」（${tags}）：停在 ${loc}`);
  }
  for (const p of inv.placed) {
    if (p.kind === "home") continue;
    const iname = items.get(p.item)?.name ?? inv.objects[p.item]?.definition.name ?? p.item;
    const loc = p.location ? (places.get(p.location)?.name ?? p.location) : "位置未知";
    footprintLines.push(
      `- 留置 ${iname}${p.count > 1 ? `×${p.count}` : ""}：${p.kind}:${p.target}（${loc}${p.note ? `；${p.note}` : ""}）`,
    );
  }

  const since = cursor.lastAt ?? clock.startedAt ?? clock.sceneStartedAt;
  const elapsedHours = Math.max(0, Math.floor((world.time - since) / 60));
  const spanHint =
    !scope?.backlog && elapsedHours >= 48
      ? `【时间跨度提示】\n距离上次宏观推演已过去约 ${Math.floor(elapsedHours / 24)} 个游戏日（${elapsedHours} 小时），请按多日真实尺度合理推进局势与媒体动静。`
      : undefined;

  const rumors = rumorSection(city);
  const canon = scope?.backlog
    ? undefined
    : canonSection(extras.data, extras.startTime, world.time);

  const content = userMessage({
    scene: [
      `【当前状态】\n${stateSummary(world, records, extras.data)}`,
      ...(spanHint ? [spanHint] : []),
      ...(footprintLines.length > 0
        ? [
            `【留置隐患与遗弃车辆】（世界可按情理拖走、搜刮、追查或发酵）\n${footprintLines.join("\n")}`,
          ]
        : []),
      `【本批范围】\n上次宏观推演：${cursor.lastAt === null ? "尚未推演" : formatGameTime(cursor.lastAt)}；已处理到回合 ${cursor.processedThrough}；当前 ${formatGameTime(world.time)}。`,
      ...(scope?.backlog
        ? [
            `【积压分批处理】\n本批只处理回合 ${cursor.processedThrough + 1} 至 ${scope.through} 的已定稿正文。当前状态始终优先于历史描述，不能回滚人物生死、归属或已结束的事件；不要仅因到期就重复推进事项。`,
          ]
        : []),
      `【关键人物生死索引】（核对本局生死与势力，不凭空假定原作结局）\n${
        Object.values(roster)
          .filter((n) => relevantNpcIds.has(n.id) || n.canon || !n.alive)
          .map((n) => `- ${n.id}｜${n.name}｜${n.role}｜${n.faction}｜${n.alive ? "在世" : "已死"}`)
          .join("\n") || "（暂无）"
      }`,
      `【城中局势】\n${due}`,
      ...(concerns ? [`【心事前因与素材】（未发生的素材不能当现状或命运）\n${concerns}`] : []),
      ...offscreenMerchantContext(world, extras.data ?? {}),
      ...(jobs.length > 0
        ? [
            `【当前委托及近期收场】（仅作因果背景）\n${jobs.map((j) => `- ${j.id}｜${j.title}｜${j.status}｜雇主：${j.client}｜冲突：${j.conflict}${j.summary ? `｜收场：${j.summary}` : ""}`).join("\n")}`,
          ]
        : []),
      ...(clock.deadlines.some((d) => d.handledAt === null)
        ? [
            `【尚未回应的期限】\n${clock.deadlines
              .filter((d) => d.handledAt === null)
              .map(
                (d) =>
                  `- ${d.id}｜${d.label}｜${formatGameTime(d.due)}${d.due <= world.time ? "｜已到期" : ""}`,
              )
              .join("\n")}`,
          ]
        : []),
      ...(rumors ? [`【近期街头传闻】\n${rumors}`] : []),
      ...(canon ? [`【2077 世界时间线】（只是无人插手时的参考）\n${canon}`] : []),
      `【势力打算素材】（本批相关与轮换素材；有前因且有空位才考虑开新事）\n${
        seeds
          .filter((s) => selectedSeeds.has(s.id))
          .map(
            (s) =>
              `- 种子：${s.id}｜主人：${s.faction}｜${s.title}｜想要：${s.goal}｜法子：${s.means.join("；")}｜能争城区：${s.districts.join("、") || "不争地盘"}｜对头：${s.rivals.join("、") || "无"}`,
          )
          .join("\n") || "（没有）"
      }`,
      ...(pending.length > 0
        ? [
            `【上次成功推演后的正文】\n${pending.map((r) => `回合 ${r.seq}：\n${r.text}`).join("\n\n")}`,
          ]
        : []),
    ],
    input: `【当前这一轮正文${scope?.backlog ? "：仅作现状保护，后续批次处理" : ""}】\n${narrative}`,
    reminder: "（只输出一个 JSON 对象。）",
  });

  return [
    { role: "system", content: MACRO_OFFSCREEN_SYSTEM },
    { role: "user", content },
  ];
}

export function prepareMacroOffscreenBatch(
  world: WorldState,
  records: readonly LogRecord[],
  extras: PromptExtras,
  narrative: string,
  capacity: OffscreenCapacity,
): OffscreenBatch {
  return fitOffscreenBatch(world, records, "macro", capacity, (scope) =>
    buildMacroOffscreenPrompt(world, records, extras, narrative, scope),
  );
}

export interface OffscreenParseResult {
  /** L0 顶层解析是否成功；单条降级或跳过不影响整批提交 */
  readonly ok: boolean;
  readonly commands: Command[];
  readonly notes: string[];
  /** L0 失败时的原因，用于触发限额 repair */
  readonly fatal?: string;
}

/** L0/L1/L2 分级容错解析宏观推演结果：顶层合法即逐条清洗降级，绝不因单条小错整批作废。 */
export function readMacroOffscreen(
  text: string,
  world: WorldState,
  opts: { readonly data?: Readonly<Record<string, unknown>> } = {},
): OffscreenParseResult {
  const commands: Command[] = [];
  const notes: string[] = [];
  const json = parseModelJson(text);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  ) {
    const fatal = `宏观推演结果不是合法 JSON 对象${json.ok ? "" : `：${json.error}`}`;
    return { ok: false, commands, notes: [fatal], fatal };
  }
  const raw = json.value as Record<string, unknown>;
  if (!Array.isArray(raw.situations)) {
    const fatal = "宏观推演缺少 situations 数组";
    return { ok: false, commands, notes: [fatal], fatal };
  }

  const threadsState = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const activeMap = new Map(threadsState.threads.map((t) => [t.id, t] as const));
  const closedMap = new Map(threadsState.closed.map((t) => [t.id, t] as const));
  const touched = new Set<string>();
  const steppedIds = new Set<string>();
  const eventSummaries: OffscreenEventSummary[] = [];
  const rumorCommands: Command[] = [];
  const credits: Command[] = [];
  let activeCount = threadsState.threads.length;
  let majors = 0;
  let keptSituations = 0;
  let keptRumors = 0;

  const pushRumor = (rawRumor: z.infer<typeof MacroRumorSchema>, eventId?: string): void => {
    if (keptRumors >= soft(OFFSCREEN_RUMORS)) {
      notes.push(`宏观推演：传闻超过 ${soft(OFFSCREEN_RUMORS)} 条，多余已截断`);
      return;
    }
    keptRumors += 1;
    rumorCommands.push({
      type: "city.rumor",
      ...(eventId ? { event: eventId } : {}),
      text: rawRumor.text,
      truth: rawRumor.truth,
      reach: rawRumor.reach,
      ...(rawRumor.district ? { district: rawRumor.district } : {}),
      player: rawRumor.player ?? false,
    });
  };

  for (const [i, item] of raw.situations.entries()) {
    const parsed = MacroSituationSchema.safeParse(item);
    if (!parsed.success) {
      notes.push(
        `宏观推演：situations[${i}] 格式不对已跳过（${parsed.error.issues[0]?.message ?? "校验失败"}）`,
      );
      continue;
    }
    const s = parsed.data;
    if (touched.has(s.id)) {
      notes.push(`宏观推演：局势 ${s.id} 本批重复出现，跳过后续条目`);
      continue;
    }
    if (keptSituations >= soft(OFFSCREEN_EVENTS)) {
      notes.push(`宏观推演：局势操作超过 ${soft(OFFSCREEN_EVENTS)} 条，多余已截断`);
      break;
    }

    if (s.op === "open") {
      if (activeMap.has(s.id)) {
        notes.push(`宏观推演：局势 ${s.id} 已在单子上，跳过重复开立`);
        continue;
      }
      if (activeCount >= THREADS_MAX) {
        notes.push(`宏观推演：局势已达上限 ${THREADS_MAX} 件，跳过开立 ${s.id}`);
        continue;
      }
      const kind = s.kind ?? "civic";
      const owner = kind === "civic" ? null : (s.owner ?? null);
      if (
        kind !== "civic" &&
        (!owner || ((kind === "nemesis" || kind === "concern") && !npcs[owner]?.alive))
      ) {
        notes.push(`宏观推演：开立 ${s.id} 缺少在世主人，已跳过`);
        continue;
      }
      const title = s.title ?? s.id.slice(0, THREAD_TITLE_MAX);
      const want = s.want ?? s.stage ?? title;
      const stage = s.stage ?? s.truth?.slice(0, THREAD_STAGE_MAX) ?? title;
      let weight = s.weight ?? "normal";
      if (weight === "major") {
        majors += 1;
        if (majors > OFFSCREEN_MAJOR) {
          weight = "normal";
          notes.push(`宏观推演：头条一次最多 ${OFFSCREEN_MAJOR} 条，「${title}」已降为 normal`);
        }
      }
      const status = s.status && s.status !== "over" ? s.status : "brewing";
      const days = s.days ?? 3;
      const body = s.truth ?? stage;
      commands.push({
        type: "thread.open",
        id: s.id,
        kind,
        owner,
        seed: s.seed ?? null,
        title,
        district: s.district ?? null,
        weight,
        status,
        want,
        stage,
        body,
        days,
      });
      eventSummaries.push({ id: s.id, title, body, status });
      touched.add(s.id);
      activeCount += 1;
      keptSituations += 1;
      for (const r of s.rumors ?? []) pushRumor(r, s.id);
      if (s.playerCred && weight === "major") {
        credits.push({
          type: "streetCred",
          levels: CRED_SIZES[s.playerCred],
          reason: `上了头条：${title}`,
          event: `city:${s.id}`,
        });
      }
      continue;
    }

    const existing = activeMap.get(s.id);
    if (!existing) {
      notes.push(`宏观推演：局势 ${s.id} 不在活跃单子上，跳过 ${s.op}`);
      continue;
    }

    if (s.op === "defer") {
      commands.push({
        type: "thread.defer",
        id: s.id,
        days: s.days ?? 3,
        why: s.why ?? s.truth?.slice(0, THREAD_NEWS_MAX) ?? "局势暂缓",
      });
      touched.add(s.id);
      keptSituations += 1;
      continue;
    }

    if (s.op === "close") {
      const end = s.truth ?? s.stage ?? "此事告一段落";
      commands.push({
        type: "thread.close",
        id: s.id,
        end,
        ...(s.fate ? { fate: s.fate } : {}),
      });
      eventSummaries.push({ id: s.id, title: existing.title, body: end, status: "over" });
      touched.add(s.id);
      activeCount -= 1;
      keptSituations += 1;
      for (const r of s.rumors ?? []) pushRumor(r, s.id);
      continue;
    }

    // op === "step"
    if (
      (existing.kind === "nemesis" || existing.kind === "concern") &&
      existing.owner !== null &&
      !npcs[existing.owner]?.alive
    ) {
      notes.push(`宏观推演：局势 ${s.id} 的主人已死，跳过推进`);
      continue;
    }
    const truth = s.truth ?? s.stage;
    if (!truth) {
      notes.push(`宏观推演：局势 ${s.id} 的 step 缺少 truth，已跳过`);
      continue;
    }
    let weight = s.weight ?? existing.weight;
    if (weight === "major") {
      majors += 1;
      if (majors > OFFSCREEN_MAJOR) {
        weight = "normal";
        notes.push(
          `宏观推演：头条一次最多 ${OFFSCREEN_MAJOR} 条，「${existing.title}」已降为 normal`,
        );
      }
    }
    const status =
      s.status && s.status !== "over"
        ? s.status
        : existing.status === "brewing"
          ? "heating"
          : existing.status;
    const news = s.publicText ?? truth.slice(0, THREAD_NEWS_MAX);
    commands.push({
      type: "thread.step",
      id: s.id,
      text: truth,
      news,
      ...(s.stage ? { stage: s.stage } : {}),
      ...(s.district !== undefined ? { district: s.district } : {}),
      weight,
      status: status === "over" ? "cooling" : status,
      turf: s.turf ?? null,
      days: s.days ?? 3,
    });
    eventSummaries.push({
      id: s.id,
      title: existing.title,
      body: truth,
      status: status === "over" ? "cooling" : status,
    });
    touched.add(s.id);
    steppedIds.add(s.id);
    keptSituations += 1;
    for (const r of s.rumors ?? []) pushRumor(r, s.id);
    if (s.playerCred && weight === "major") {
      credits.push({
        type: "streetCred",
        levels: CRED_SIZES[s.playerCred],
        reason: `上了头条：${existing.title}`,
        event: `city:${s.id}`,
      });
    }
  }

  // 独立街头传闻
  if (Array.isArray(raw.standaloneRumors)) {
    for (const [i, item] of raw.standaloneRumors.entries()) {
      const parsed = MacroRumorSchema.safeParse(item);
      if (!parsed.success) {
        notes.push(`宏观推演：standaloneRumors[${i}] 格式不对已跳过`);
        continue;
      }
      pushRumor(parsed.data);
    }
  }

  // 商家经营与供货路况变化（L2 局部容错：不合格条目只记录 notes 跳过）
  const merchantChanges = readOffscreenMerchantChanges(
    raw.merchantChanges,
    world,
    commands,
    opts.data ?? {},
    eventSummaries,
  );
  for (const note of merchantChanges.notes) notes.push(`宏观推演：${note}`);
  commands.push(...rumorCommands, ...merchantChanges.commands);

  // 新闻与电台快讯：仅对确实产生新 step 或原有未听说 step 的局势发 threadTold
  if (raw.bulletin !== undefined && raw.bulletin !== null) {
    const parsed = MacroBulletinSchema.safeParse(raw.bulletin);
    if (!parsed.success) {
      notes.push(
        `宏观推演：bulletin 格式不对已跳过（${parsed.error.issues[0]?.message ?? "校验失败"}）`,
      );
    } else {
      const { situationIds, ...bulletin } = parsed.data;
      commands.push({ type: "city.bulletin", ...bulletin });
      for (const id of new Set(situationIds ?? [])) {
        const existing = activeMap.get(id) ?? closedMap.get(id);
        const hasUntold = steppedIds.has(id) || (existing?.steps.some((st) => !st.told) ?? false);
        if (!hasUntold) {
          notes.push(`宏观推演：快讯关联的 ${id} 没有新的公开进展，已剥离关联`);
          continue;
        }
        commands.push({ type: "threadTold", id });
      }
    }
  } else if (majors > 0) {
    notes.push("宏观推演：本批写了头条局势但未附带新闻快讯");
  }

  commands.push(...credits);
  return { ok: true, commands, notes };
}
