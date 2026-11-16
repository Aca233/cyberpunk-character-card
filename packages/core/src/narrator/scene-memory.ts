import type { WorldState } from "../kernel/world";
import type { TurnInput } from "../schemas/turn";
import {
  type MemoryAnchor,
  type MemorySceneCommand,
  MemoryStateSchema,
  type MemoryWorkingCommand,
  SceneMemoryUpdateSchema,
  SceneSummaryProposalSchema,
} from "../systems/memory/schema";
import { NpcStateSchema } from "../systems/npc/schema";
import { formatGameTime } from "../systems/world/apply";
import { WorldClockStateSchema } from "../systems/world/schema";
import { issueText } from "./block";

const ANCHORS_SHOWN = 8;
const SECTION_CHARS = 2_000;
const ANCHOR_LABEL = {
  fact: "已确认",
  promise: "承诺，尚未兑现",
  plan: "计划，尚未实行",
  question: "待解问题",
} as const;
const RESOLUTION_LABEL = {
  fulfilled: "已兑现",
  cancelled: "已取消",
  answered: "已有答案",
} as const;

export function memoryAnchorText(anchor: MemoryAnchor): string {
  const status = anchor.resolution
    ? `${RESOLUTION_LABEL[anchor.resolution.outcome]}：${anchor.resolution.text}`
    : ANCHOR_LABEL[anchor.kind];
  return `${anchor.text}（${status}；登记于 ${formatGameTime(anchor.at)}${anchor.resolution ? `；结果记于 ${formatGameTime(anchor.resolution.at)}` : ""}）`;
}

/** 主线和抽取共用同一小块记忆；未展示的锚点仍留在持久库与检索候选池里。 */
export function sceneMemorySection(world: WorldState, input = ""): string | undefined {
  const memory = MemoryStateSchema.parse(world.slices.memory ?? {});
  const scene = WorldClockStateSchema.parse(world.slices.world).scene;
  const active = memory.active?.scene === scene ? memory.active : null;
  const pending = [
    ...Object.values(memory.pending),
    ...(memory.active && !active ? [memory.active] : []),
  ].sort((a, b) => b.at - a.at)[0];
  const roster = NpcStateSchema.parse(world.slices.npc).npcs;
  const score = (anchor: MemoryAnchor) => {
    const terms = [
      anchor.id,
      ...anchor.keywords,
      ...anchor.people.flatMap((id) => [id, roster[id]?.name ?? ""]),
    ];
    const mentioned = terms.some((term) => term.length >= 2 && input.includes(term));
    return (
      Number(mentioned) * 8 +
      Number(anchor.resolution === null && anchor.kind !== "fact") * 4 +
      Number(anchor.scene === scene) * 2
    );
  };
  const anchors = Object.values(memory.anchors).sort(
    (a, b) => score(b) - score(a) || a.at - b.at || a.id.localeCompare(b.id),
  );
  if (!active && !pending && anchors.length === 0) return undefined;
  const lines = [
    "【场景记忆与未完事项】",
    "这是已保存的记忆。承诺、计划和疑问保留原状态；没列出的锚点不代表消失。",
  ];
  if (active) lines.push(`本场至今：${active.text}`);
  if (pending)
    lines.push(`第 ${pending.scene + 1} 场待整理提要（保留原文，非完整收场摘要）：${pending.text}`);
  let size = lines.join("\n").length;
  let shown = 0;
  for (const anchor of anchors) {
    if (shown >= ANCHORS_SHOWN) break;
    const line = `- ${anchor.id}｜${memoryAnchorText(anchor)}`;
    if (size + line.length + 65 > SECTION_CHARS) continue;
    lines.push(line);
    size += line.length + 1;
    shown++;
  }
  if (shown < anchors.length)
    lines.push(
      `另有 ${anchors.length - shown} 条已保存锚点，可从旧记忆检索；本轮没提及的保持原样。`,
    );
  return lines.join("\n");
}

export interface WorkingMemoryResult {
  readonly command?: MemoryWorkingCommand;
  readonly notes: readonly string[];
}

export interface SceneSummarySource {
  readonly input: TurnInput;
  readonly narrative: string;
}

/** 只接受本轮确有原文证据的增量；无效更新整份拒绝，不能覆盖已保存的提要或锚点。 */
export function readSceneMemory(
  raw: unknown,
  before: WorldState,
  after: WorldState,
  input: TurnInput,
  narrative: string,
): WorkingMemoryResult {
  const parsed = SceneMemoryUpdateSchema.safeParse(raw);
  if (!parsed.success)
    return { notes: [`场景记忆更新未保存：${issueText(parsed.error)}；保留此前记忆`] };
  const update = parsed.data;
  const memory = MemoryStateSchema.parse(before.slices.memory ?? {});
  const roster = NpcStateSchema.parse(after.slices.npc).npcs;
  const clock = WorldClockStateSchema.parse(before.slices.world);
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const anchor of update.anchors) {
    if (seen.has(anchor.id)) errors.push(`新增锚点 ${anchor.id} 重复`);
    seen.add(anchor.id);
    const old = memory.anchors[anchor.id];
    if (old && (old.text !== anchor.text || old.kind !== anchor.kind))
      errors.push(`锚点 ${anchor.id} 不能改写旧事实`);
    for (const person of anchor.people)
      if (!roster[person]) errors.push(`锚点 ${anchor.id} 引用了未知人物 ${person}`);
  }
  const resolved = new Set<string>();
  for (const resolution of update.resolve) {
    const anchor = memory.anchors[resolution.id];
    if (resolved.has(resolution.id)) errors.push(`锚点 ${resolution.id} 重复给出结果`);
    resolved.add(resolution.id);
    if (!anchor || anchor.resolution !== null)
      errors.push(`锚点 ${resolution.id} 不是已有未解决事项`);
    else if (anchor.kind === "fact")
      errors.push(`锚点 ${resolution.id} 是既有事实，不能当待办勾销`);
    else if (resolution.outcome === "answered" && anchor.kind !== "question")
      errors.push(`锚点 ${resolution.id} 不是待解问题`);
    else if (resolution.outcome === "fulfilled" && anchor.kind === "question")
      errors.push(`锚点 ${resolution.id} 应记录答案而非兑现`);
  }
  for (const entry of [...update.anchors, ...update.resolve]) {
    const source = entry.evidence.source === "input" ? input.text : narrative;
    if (!source.includes(entry.evidence.quote))
      errors.push(
        `锚点 ${entry.id} 的证据不在本轮${entry.evidence.source === "input" ? "输入" : "正文"}中`,
      );
  }
  if (errors.length > 0)
    return { notes: [`场景记忆更新未保存：${errors.join("；")}；保留此前记忆`] };
  return {
    command: { type: "memory.working", scene: clock.scene, place: clock.location, ...update },
    notes: [],
  };
}

/** 合并抽取的摘要严格验格式和人物；失效时由调用处决定质量恢复，不伪造摘要。 */
export function summaryFromExtract(
  raw: unknown,
  world: WorldState,
  scene: number,
  place: string | null,
  source: SceneSummarySource,
): { readonly command?: MemorySceneCommand; readonly notes: readonly string[] } {
  const parsed = SceneSummaryProposalSchema.safeParse(raw);
  if (!parsed.success) return { notes: [`合并摘要需要重新整理：${issueText(parsed.error)}`] };
  const roster = NpcStateSchema.parse(world.slices.npc).npcs;
  const missing = parsed.data.people.filter((id) => !roster[id]);
  if (missing.length > 0) return { notes: [`合并摘要引用了未知人物：${missing.join("、")}`] };
  const memory = MemoryStateSchema.parse(world.slices.memory ?? {});
  const overview = memory.active?.scene === scene ? memory.active : memory.pending[String(scene)];
  const corpus = [
    overview?.text ?? "",
    ...Object.values(memory.anchors)
      .filter((anchor) => anchor.scene === scene)
      .map(memoryAnchorText),
    source.input.text,
    source.narrative,
  ].join("\n");
  // 只排除明显退化，不将长度或关键词匹配宣称为语义充分；短场景不强迫灌水。
  const minimum = Math.min(80, Math.max(12, Math.floor(corpus.replace(/\s/g, "").length * 0.28)));
  if (parsed.data.text.length < minimum)
    return {
      notes: [
        `合并摘要过于简略（${parsed.data.text.length} 字，本场至少 ${minimum} 字），需要重新整理`,
      ],
    };
  const grounded = parsed.data.keywords.filter(
    (word) => corpus.includes(word) && parsed.data.text.includes(word),
  );
  if (grounded.length === 0)
    return { notes: ["合并摘要缺少同时见于本场来源和摘要正文的关键词，需要重新整理"] };
  const body = parsed.data.text.replace(/[\s\p{P}]/gu, "");
  if (body.length >= 40 && new Set(body).size / body.length < 0.2)
    return { notes: ["合并摘要存在大量重复内容，需要重新整理"] };
  return { command: { type: "memory.scene", scene, place, ...parsed.data }, notes: [] };
}
