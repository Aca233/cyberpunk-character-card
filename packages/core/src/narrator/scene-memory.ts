import type { WorldState } from "../kernel/world";
import type { TurnInput } from "../schemas/turn";
import { CyberwareStateSchema } from "../systems/cyberware/schema";
import { EconomyStateSchema } from "../systems/economy/schema";
import { InventoryStateSchema } from "../systems/inventory/schema";
import {
  type MemoryAnchor,
  MemoryAnchorFieldsSchema,
  MemoryAnchorResolutionSchema,
  type MemorySceneCommand,
  MemoryStateSchema,
  type MemoryWorkingCommand,
  SCENE_MEMORY_CHARS,
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
  report: "转述或自述，真伪未核实",
} as const;
const RESOLUTION_LABEL = {
  fulfilled: "已兑现",
  cancelled: "已取消",
  answered: "已有答案",
} as const;

export function unresolvedMemoryAnchor(anchor: MemoryAnchor): boolean {
  return (
    anchor.resolution === null &&
    (anchor.kind === "promise" || anchor.kind === "plan" || anchor.kind === "question")
  );
}

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
  const corrected = memory.scenes
    .filter((entry) => memory.corrections[String(entry.scene)]?.action === "edit")
    .sort(
      (a, b) =>
        Number(b.keywords.some((word) => input.includes(word))) -
          Number(a.keywords.some((word) => input.includes(word))) ||
        (memory.corrections[String(b.scene)]?.at ?? 0) -
          (memory.corrections[String(a.scene)]?.at ?? 0),
    )
    .slice(0, 2);
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
      Number(unresolvedMemoryAnchor(anchor)) * 4 +
      Number(anchor.scene === scene) * 2
    );
  };
  const anchors = Object.values(memory.anchors).sort(
    (a, b) => score(b) - score(a) || a.at - b.at || a.id.localeCompare(b.id),
  );
  if (!active && !pending && anchors.length === 0 && corrected.length === 0) return undefined;
  const lines = [
    "【场景记忆与未完事项】",
    "这是已保存的记忆。承诺、计划和疑问保留原状态；没列出的锚点不代表消失。",
  ];
  if (active) lines.push(`本场至今：${active.text}`);
  if (pending)
    lines.push(`第 ${pending.scene + 1} 场待整理提要（保留原文，非完整收场摘要）：${pending.text}`);
  for (const entry of corrected)
    lines.push(`玩家已纠正第 ${entry.scene + 1} 场（替代该场旧原文与衍生记忆）：${entry.text}`);
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

function itemCount(world: WorldState, id: string): number {
  const state = InventoryStateSchema.parse(world.slices.inventory);
  const part = CyberwareStateSchema.parse(world.slices.cyberware).parts[id];
  let customizedCount = 0;
  let supplyCount = 0;
  let attachedModCount = 0;
  for (const [carriedId, count] of Object.entries(state.backpack)) {
    if (count < 1) continue;
    const obj = state.objects[carriedId];
    if (obj?.baseId === id) supplyCount += count;
    if (!obj?.weaponState) continue;
    if (obj.kind === "customized" && obj.weaponState.baseId === id) {
      customizedCount += count;
    }
    for (const modId of Object.values(obj.weaponState.mods)) {
      if (modId === id) attachedModCount += count;
    }
  }
  return (
    Number(part?.holder === "player" && part.location === null && part.condition !== "scrapped") +
    (state.backpack[id] ?? 0) +
    customizedCount +
    supplyCount +
    Object.values(state.clothing).filter((value) => value === id).length +
    [state.healing, state.grenade].filter(
      (slot) =>
        slot && slot.charges > 0 && (slot.id === id || state.objects[slot.id]?.baseId === id),
    ).length +
    attachedModCount
  );
}

/** 对证据比对做无损标点与空白归一化：不放宽事实本身，只避免中英文引号、破折号或多余空白误杀合法引用。 */
function normalizeEvidenceText(text: string): string {
  return text
    .replace(/[「」『』“”‘’"]/g, '"')
    .replace(/[——–―—]+/g, "-")
    .replace(/……|…/g, "...")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/。/g, ".")
    .replace(/！/g, "!")
    .replace(/？/g, "?")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s+/g, "");
}

function evidenceMatches(source: string, quote: string): boolean {
  if (source.includes(quote)) return true;
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length < 2) return false;
  return normalizeEvidenceText(source).includes(normalizedQuote);
}

/** 仅接受本轮确有原文证据的增量；单条锚点或勾销不合格时只跳过该条并记录说明，保留合法提要与其余锚点。 */
export function readSceneMemory(
  raw: unknown,
  before: WorldState,
  after: WorldState,
  input: TurnInput,
  narrative: string,
): WorkingMemoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { notes: ["场景记忆更新未保存：sceneMemory 不是对象；保留此前记忆"] };
  }
  const obj = raw as Record<string, unknown>;
  const rawText = typeof obj.text === "string" ? obj.text.trim() : "";
  if (rawText.length === 0) {
    return { notes: ["场景记忆更新未保存：提要 text 为空；保留此前记忆"] };
  }
  const text = [...rawText].slice(0, SCENE_MEMORY_CHARS).join("");
  const notes: string[] = [];
  if (text.length < rawText.length) {
    notes.push(`场景记忆提要超过 ${SCENE_MEMORY_CHARS} 字，已保留前 ${SCENE_MEMORY_CHARS} 字`);
  }

  const memory = MemoryStateSchema.parse(before.slices.memory ?? {});
  const roster = NpcStateSchema.parse(after.slices.npc).npcs;
  const clock = WorldClockStateSchema.parse(before.slices.world);

  const checkSettlement = (
    id: string,
    settlement: readonly (
      | { readonly type: "item"; readonly id: string; readonly delta: number }
      | { readonly type: "money"; readonly delta: number }
    )[],
  ): string | undefined => {
    for (const claim of settlement) {
      const actual =
        claim.type === "money"
          ? EconomyStateSchema.parse(after.slices.economy).eddies -
            EconomyStateSchema.parse(before.slices.economy).eddies
          : itemCount(after, claim.id) - itemCount(before, claim.id);
      if (actual !== claim.delta) {
        return `锚点 ${id} 声称的${claim.type === "money" ? "欧元" : claim.id}净变化 ${claim.delta} 与本轮实际结算 ${actual} 不符`;
      }
    }
    return undefined;
  };

  const rawAnchors = Array.isArray(obj.anchors) ? obj.anchors : [];
  if (obj.anchors !== undefined && !Array.isArray(obj.anchors)) {
    notes.push("场景记忆 anchors 格式不是数组，已忽略新增锚点");
  }
  const anchors: MemoryWorkingCommand["anchors"][number][] = [];
  const seen = new Set<string>();
  for (const [index, rawAnchor] of rawAnchors.entries()) {
    const parsed = MemoryAnchorFieldsSchema.safeParse(rawAnchor);
    if (!parsed.success) {
      notes.push(`新增锚点[${index}] 格式无效已跳过：${issueText(parsed.error)}`);
      continue;
    }
    const anchor = parsed.data;
    const itemErrors: string[] = [];
    if (seen.has(anchor.id)) itemErrors.push(`新增锚点 ${anchor.id} 重复`);
    const old = memory.anchors[anchor.id];
    if (old && (old.text !== anchor.text || old.kind !== anchor.kind)) {
      itemErrors.push(`锚点 ${anchor.id} 不能改写旧事实`);
    }
    for (const person of anchor.people) {
      if (!roster[person]) itemErrors.push(`锚点 ${anchor.id} 引用了未知人物 ${person}`);
    }
    if (anchor.kind === "fact" && anchor.evidence.source !== "narrative") {
      itemErrors.push(
        `锚点 ${anchor.id} 的已发生事实不能仅凭玩家输入成立；打算用 plan、自述用 report，实际结果须有正文证据`,
      );
    }
    if (anchor.kind !== "fact" && anchor.settlement) {
      itemErrors.push(`锚点 ${anchor.id} 不是已发生事实，不能挂结算结果`);
    }
    const source = anchor.evidence.source === "input" ? input.text : narrative;
    if (!evidenceMatches(source, anchor.evidence.quote)) {
      itemErrors.push(
        `锚点 ${anchor.id} 的证据不在本轮${anchor.evidence.source === "input" ? "输入" : "正文"}中`,
      );
    }
    if (anchor.settlement) {
      const mismatch = checkSettlement(anchor.id, anchor.settlement);
      if (mismatch) itemErrors.push(mismatch);
    }
    if (itemErrors.length > 0) {
      notes.push(`新增锚点 ${anchor.id} 已跳过：${itemErrors.join("；")}`);
      continue;
    }
    seen.add(anchor.id);
    anchors.push(anchor);
  }

  const rawResolve = Array.isArray(obj.resolve) ? obj.resolve : [];
  if (obj.resolve !== undefined && !Array.isArray(obj.resolve)) {
    notes.push("场景记忆 resolve 格式不是数组，已忽略锚点勾销");
  }
  const resolve: MemoryWorkingCommand["resolve"][number][] = [];
  const resolved = new Set<string>();
  for (const [index, rawRes] of rawResolve.entries()) {
    const parsed = MemoryAnchorResolutionSchema.safeParse(rawRes);
    if (!parsed.success) {
      notes.push(`锚点勾销[${index}] 格式无效已跳过：${issueText(parsed.error)}`);
      continue;
    }
    const resolution = parsed.data;
    const itemErrors: string[] = [];
    const anchor = memory.anchors[resolution.id];
    if (resolved.has(resolution.id)) itemErrors.push(`锚点 ${resolution.id} 重复给出结果`);
    if (!anchor || anchor.resolution !== null) {
      itemErrors.push(`锚点 ${resolution.id} 不是已有未解决事项`);
    } else if (anchor.kind === "fact" || anchor.kind === "report") {
      itemErrors.push(`锚点 ${resolution.id} 不是待办，不能勾销`);
    } else if (resolution.outcome === "answered" && anchor.kind !== "question") {
      itemErrors.push(`锚点 ${resolution.id} 不是待解问题`);
    } else if (resolution.outcome === "fulfilled" && anchor.kind === "question") {
      itemErrors.push(`锚点 ${resolution.id} 应记录答案而非兑现`);
    }
    if (resolution.outcome === "fulfilled" && resolution.evidence.source !== "narrative") {
      itemErrors.push(
        `锚点 ${resolution.id} 兑现须有正文结果，玩家输入中的行动意图不能单独结清承诺`,
      );
    }
    const source = resolution.evidence.source === "input" ? input.text : narrative;
    if (!evidenceMatches(source, resolution.evidence.quote)) {
      itemErrors.push(
        `锚点 ${resolution.id} 的证据不在本轮${resolution.evidence.source === "input" ? "输入" : "正文"}中`,
      );
    }
    if (resolution.settlement) {
      const mismatch = checkSettlement(resolution.id, resolution.settlement);
      if (mismatch) itemErrors.push(mismatch);
    }
    if (itemErrors.length > 0) {
      notes.push(`锚点勾销 ${resolution.id} 已跳过：${itemErrors.join("；")}`);
      continue;
    }
    resolved.add(resolution.id);
    resolve.push(resolution);
  }

  return {
    command: {
      type: "memory.working",
      scene: clock.scene,
      place: clock.location,
      text,
      anchors,
      resolve,
    },
    notes,
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
