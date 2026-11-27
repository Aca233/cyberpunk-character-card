import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import type { CyberwareState } from "../cyberware";
import type { HealthState } from "../health";
import { HumanityStateSchema, isImmunosuppressed, neuralStage, STAGE_LABELS } from "../humanity";
import { InventoryStateSchema, itemCatalog } from "../inventory";
import { chipContentCatalog, ShardsStateSchema } from "../shards";
import { merchantAt, merchantSites, type WorldClockState } from "../world";
import {
  BD_LAYER_LABELS,
  BD_MODE_LABELS,
  BD_TIER_LABELS,
  type BdExperience,
  type BdLayer,
  type BdSource,
  type BdWork,
  BdWorkListSchema,
  type BraindanceCommand,
  type BraindanceState,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });
const cache = new WeakMap<object, readonly BdWork[]>();

export function braindanceCatalog(data: Data): readonly BdWork[] {
  const raw = data.braindances;
  if (!raw || typeof raw !== "object") return [];
  const saved = cache.get(raw);
  if (saved) return saved;
  const works = BdWorkListSchema.parse(raw);
  cache.set(raw, works);
  return works;
}

export function braindanceWork(state: BraindanceState, data: Data, id: string): BdWork | undefined {
  return state.works[id] ?? braindanceCatalog(data).find((w) => w.id === id);
}

const projectedData = new WeakMap<BraindanceState, WeakMap<object, Data>>();
/** 供其他系统读取的最小超梦目录信息；不把片段梗概或未发现细节暴露给其他系统。 */
export function withBraindanceData(state: BraindanceState, data: Data): Data {
  let byBase = projectedData.get(state);
  if (!byBase) {
    byBase = new WeakMap();
    projectedData.set(state, byBase);
  }
  const previous = byBase.get(data);
  if (previous) return previous;
  const merged = {
    ...data,
    braindanceWorks: Object.fromEntries(
      Object.values(state.works).map((work) => [
        work.id,
        { id: work.id, title: work.title, tier: work.tier, durationMinutes: work.durationMinutes },
      ]),
    ),
    braindanceActivity: state.active,
  };
  byBase.set(data, merged);
  return merged;
}

export interface BdSourceOption {
  source: BdSource;
  analysis: readonly BdLayer[];
}

export function braindanceSources(
  work: BdWork,
  data: Data,
  slices: Readonly<Record<string, unknown>>,
): readonly BdSourceOption[] {
  const here = (slices.world as WorldClockState).location;
  const inventory = InventoryStateSchema.parse(slices.inventory);
  const catalog = itemCatalog(data);
  const accessible = (id: string): boolean => {
    const obj = inventory.objects[id];
    if ((inventory.backpack[id] ?? 0) > 0 && (!obj || obj.holder === "player")) return true;
    return inventory.placed.some(
      (p) =>
        p.item === id &&
        here !== null &&
        p.location === here &&
        p.kind !== "npc" &&
        (!obj || obj.holder === `${p.kind}:${p.target}`),
    );
  };
  const ids = new Set([...Object.keys(inventory.backpack), ...inventory.placed.map((p) => p.item)]);
  const available = [...ids]
    .filter(accessible)
    .map((id) => ({ id, definition: inventory.objects[id]?.definition ?? catalog.get(id) }));
  const devices = available.filter((d) => d.definition?.braindanceDevice?.playback);
  const contents = chipContentCatalog(data, ShardsStateSchema.parse(slices.shards));
  const result: BdSourceOption[] = [];

  for (const site of merchantSites(data).values()) {
    const device = site.braindanceDevice;
    if (!device?.playback) continue;
    const atHere = site.locations.some((loc) => merchantAt(data, site.merchant, loc, here));
    if (!atHere) continue;
    if (site.braindanceWorks.includes(work.id)) {
      result.push({
        source: { kind: "venue", venue: site.merchant },
        analysis: device.analysis,
      });
    }
  }

  for (const carrier of available) {
    const content = carrier.definition?.chipContentId
      ? contents.get(carrier.definition.chipContentId)
      : undefined;
    if (content?.braindance !== work.id) continue;
    for (const device of devices) {
      result.push({
        source: { kind: "carrier", carrier: carrier.id, device: device.id },
        analysis: device.definition?.braindanceDevice?.analysis ?? [],
      });
    }
  }
  return result;
}

function sourceOptions(work: BdWork, ctx: SystemContext) {
  return braindanceSources(work, ctx.data, {
    world: ctx.read("world"),
    inventory: ctx.read("inventory"),
    commerce: ctx.read("commerce"),
    shards: ctx.read("shards"),
  });
}

function matchSource(
  options: readonly BdSourceOption[],
  target: BdSource,
): BdSourceOption | undefined {
  return options.find((opt) => {
    if (opt.source.kind !== target.kind) return false;
    if (opt.source.kind === "venue" && target.kind === "venue") {
      return opt.source.venue === target.venue;
    }
    if (opt.source.kind === "carrier" && target.kind === "carrier") {
      return opt.source.carrier === target.carrier && opt.source.device === target.device;
    }
    return false;
  });
}

function sourceBlock(
  active: Pick<BdExperience, "source" | "location" | "mode">,
  work: BdWork,
  ctx: SystemContext,
): { error?: string; analysis: readonly BdLayer[] } {
  if (ctx.read<WorldClockState>("world").location !== active.location) {
    return { error: "先回到当前播放设备或场馆所在地点，再继续体验", analysis: [] };
  }
  const matched = matchSource(sourceOptions(work, ctx), active.source);
  if (!matched) {
    return {
      error: "没有匹配的实际超梦载体与播放设备，或当前地点不具备对应的场馆播放设备",
      analysis: [],
    };
  }
  if (active.mode === "edit" && matched.analysis.length === 0) {
    return {
      error:
        "普通便携播放器只支持沉浸回放；进入编辑分析模式需要专业超梦编辑头环（bd-editor-wreath）或调谐工作站",
      analysis: matched.analysis,
    };
  }
  return { analysis: matched.analysis };
}

function settleXbdImpact(
  work: BdWork,
  mode: "immerse" | "edit",
  experienceId: string,
  ctx: SystemContext,
): { readonly notes: string[]; readonly emit: Command[] } {
  if (work.tier !== "xbd") return { notes: [], emit: [] };
  if (mode === "edit") {
    return {
      notes: ["编辑模式已切断直接感官回灌，规避了地下黑超梦的无滤波神经冲击"],
      emit: [],
    };
  }
  const humanity = HumanityStateSchema.parse(ctx.read("humanity"));
  const eventKey = `bd:xbd:${experienceId}`;
  if (humanity.settled.includes(eventKey)) {
    return { notes: [], emit: [] };
  }
  const stage = neuralStage(humanity);
  if (isImmunosuppressed(humanity, ctx.now)) {
    return {
      notes: [
        `警告：地下黑超梦《${work.title}》触发强感官冲击，但体内神经压制剂暂时压住了失控（当前神经阶段：${STAGE_LABELS[stage]}）`,
      ],
      emit: [],
    };
  }
  const nextStage =
    stage === "stable"
      ? "detached"
      : stage === "detached"
        ? "unstable"
        : stage === "unstable"
          ? "edge"
          : "crisis";
  const symptom = work.xbdRisk
    ? `黑超梦无滤波感官过载（${work.xbdRisk}），引发剧烈眩晕、感官残留与解离`
    : "黑超梦无滤波感官过载引发剧烈眩晕、视听残留与短暂解离";
  return {
    notes: [
      `警告：未经过滤的地下黑超梦《${work.title}》造成神经冲击，神经状态进入「${STAGE_LABELS[nextStage]}」`,
    ],
    emit: [
      {
        type: "humanity",
        action: "affect",
        id: `xbd:${work.id}`,
        stage: nextStage,
        symptom,
        reason: `沉浸观看地下黑超梦《${work.title}》`,
        event: eventKey,
      },
    ],
  };
}

export function applyBraindance(
  draft: Draft<BraindanceState>,
  command: BraindanceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const target =
    command.action === "progress"
      ? command.passage
      : command.action === "scan"
        ? `${command.layer}:${command.detail ?? "all"}`
        : command.action === "play"
          ? command.id
          : command.action === "define"
            ? command.work.id
            : command.action === "record"
              ? command.workId
              : command.outcome;
  const settlementKey = JSON.stringify([
    ctx.facts.braindanceTurn ?? "direct",
    command.action,
    command.event,
    target,
  ]);
  if (draft.settled.includes(settlementKey)) return { ok: true, notes: ["本次超梦操作已经结算"] };

  if (command.action === "define") {
    if (braindanceWork(draft, ctx.data, command.work.id))
      return fail("作品已确立，不能覆盖原记录；不同剪辑请用新作品 id");
    draft.works[command.work.id] = command.work;
    draft.settled.push(settlementKey);
    return {
      ok: true,
      notes: [`记下超梦作品：${command.work.title}（${BD_TIER_LABELS[command.work.tier]}）`],
    };
  }

  if (command.action === "record") {
    const installed = ctx.read<CyberwareState>("cyberware").installed;
    const broken = ctx.read<HealthState>("health").brokenChrome;
    const hasRecorder =
      installed.some((c) => c.id === "braindance-recorder") &&
      !broken.includes("braindance-recorder");
    if (!hasRecorder) {
      return fail("现场录制超梦需要已安装且完好的义体「超梦录制器（braindance-recorder）」");
    }
    if (braindanceWork(draft, ctx.data, command.workId)) {
      return fail("该录制作品 id 已存在，请使用新的 workId");
    }
    const here = ctx.read<WorldClockState>("world").location;
    const passageId = "rec-1";
    const work: BdWork = {
      id: command.workId,
      title: command.title,
      tier: "raw",
      recorder: "玩家自录",
      synopsis: command.synopsis,
      durationMinutes: command.durationMinutes,
      ...(here ? { location: here } : {}),
      passages: [
        {
          id: passageId,
          label: "现场录制原片",
          minutes: command.durationMinutes,
          outline: command.synopsis,
        },
      ],
      details: [],
    };
    draft.works[work.id] = work;
    if (command.text) {
      draft.passages[work.id] = { [passageId]: command.text };
    }
    const contentId = `chip-${command.workId}`;
    const emit: Command[] = [
      {
        type: "shards.register",
        content: {
          id: contentId,
          title: `原片：${command.title}`,
          category: "braindance",
          kind: "recording",
          from: "个人超梦录制器",
          summary: command.synopsis,
          parts: [],
          encryption: "none",
          hazard: "none",
          eddies: 0,
          braindance: work.id,
          related: here ? [here] : [],
        },
      },
      {
        type: "inventory.chipMint",
        id: command.carrierId,
        name: `超梦原片《${command.title}》`,
        contentId,
        ability: command.synopsis,
        origin: "个人超梦录制器现场录制",
        reason: `现场录制超梦原片：${command.title}`,
      },
    ];
    draft.settled.push(settlementKey);
    return {
      ok: true,
      notes: [
        `现场录制完成：生成调查原片《${command.title}》（载体 ${command.carrierId}），已存入背包`,
      ],
      emit,
    };
  }

  if (command.action === "play") {
    const work = braindanceWork(draft, ctx.data, command.work);
    if (!work) return fail("作品尚未确立，先用 define 固定作品内容");
    const here = ctx.read<WorldClockState>("world").location;

    // 恢复或切换当前暂停/进行中的同一部作品模式
    if (draft.active) {
      if (draft.active.work !== work.id) {
        return fail("先 stop(exited/finished) 退出当前超梦，再播放另一部作品");
      }
      const nextState = {
        ...draft.active,
        mode: command.mode,
        source: command.source,
        location: here,
        status: "playing" as const,
      };
      const check = sourceBlock(nextState, work, ctx);
      if (check.error) return fail(check.error);
      draft.active = nextState;
      draft.settled.push(settlementKey);
      const impact = settleXbdImpact(work, command.mode, nextState.id, ctx);
      return {
        ok: true,
        notes: [`继续《${work.title}》（${BD_MODE_LABELS[command.mode]}模式）`, ...impact.notes],
        ...(impact.emit.length > 0 ? { emit: impact.emit } : {}),
      };
    }

    if (draft.history.some((h) => h.id === command.id))
      return fail("体验 id 已使用；重新接入请使用新的体验 id");
    const previous = command.from ? draft.history.find((h) => h.id === command.from) : undefined;
    if (command.from && (!previous || previous.work !== work.id))
      return fail("续接位置必须来自这部作品已保存的实际体验");

    const active: BdExperience = {
      id: command.id,
      work: work.id,
      mode: command.mode,
      source: command.source,
      location: here,
      startedAt: ctx.now,
      position: previous?.position ?? 0,
      watchedMinutes: previous?.watchedMinutes ?? 0,
      elapsed: 0,
      status: "playing",
    };
    const check = sourceBlock(active, work, ctx);
    if (check.error) return fail(check.error);
    draft.works[work.id] = work;
    draft.active = active;
    draft.settled.push(settlementKey);
    const impact = settleXbdImpact(work, command.mode, active.id, ctx);
    return {
      ok: true,
      notes: [
        `接入超梦《${work.title}》（${BD_TIER_LABELS[work.tier]}｜${BD_MODE_LABELS[command.mode]}）`,
        ...impact.notes,
      ],
      ...(impact.emit.length > 0 ? { emit: impact.emit } : {}),
    };
  }

  const active = draft.active;
  if (!active) return fail("当前没有接上的超梦");
  const work = braindanceWork(draft, ctx.data, active.work);
  if (!work) return fail("当前作品资料缺失");

  if (command.action === "stop") {
    let minutes = 0;
    const notes: string[] = [];
    if (command.outcome === "paused") {
      active.status = "paused";
      notes.push(`暂停超梦《${work.title}》，现场交流按普通场景记录`);
    } else if (command.outcome === "exited") {
      notes.push(`退出超梦《${work.title}》，保留已看 ${active.watchedMinutes} 分钟进度`);
      draft.history.push({ ...active, outcome: "exited", at: ctx.now });
      draft.active = null;
    } else {
      const check = sourceBlock(active, work, ctx);
      if (check.error) return fail(check.error);
      minutes = Math.max(0, work.durationMinutes - active.watchedMinutes);
      active.watchedMinutes = work.durationMinutes;
      active.position = work.passages.length;
      active.elapsed += minutes;
      notes.push(`看完超梦《${work.title}》，结算剩余 ${minutes} 分钟`);
      draft.history.push({ ...active, outcome: "finished", at: ctx.now + minutes });
      draft.active = null;
    }
    draft.settled.push(settlementKey);
    return { ok: true, notes, ...(minutes > 0 ? { advanceTo: ctx.now + minutes } : {}) };
  }

  const check = sourceBlock(active, work, ctx);
  if (check.error) return fail(check.error);
  if (active.status === "paused") {
    return fail("当前超梦已暂停，先用 play 恢复播放再继续操作");
  }

  if (command.action === "progress") {
    if (command.replay) {
      const index = work.passages.findIndex((p) => p.id === command.passage);
      const passage = work.passages[index];
      if (!passage || index >= active.position) return fail("先实际看到该片段，再重播");
      const fixed = draft.passages[work.id]?.[passage.id];
      if (fixed && command.text && fixed !== command.text) return fail("重播不能改写已有定稿原文");
      if (!fixed && !command.text) return fail("此前略写的片段首次展开重播时须提供本轮呈现原文");
      draft.passages[work.id] ??= {};
      (draft.passages[work.id] as Record<string, string>)[passage.id] =
        fixed ?? (command.text as string);
      active.elapsed += passage.minutes;
      draft.settled.push(settlementKey);
      return {
        ok: true,
        notes: [`重播「${passage.label}」：${passage.minutes} 分钟`],
        advanceTo: ctx.now + passage.minutes,
      };
    }

    const passage = work.passages[active.position];
    if (!passage || passage.id !== command.passage)
      return fail("只可从已保存的位置接着呈现下一片段");
    const fixed = draft.passages[work.id]?.[passage.id];
    if (fixed && command.text && fixed !== command.text)
      return fail("该片段已有定稿，重看不能改写原文");
    if (!fixed && !command.text) return fail("初次呈现该片段须保存本轮正文中的作品原文");
    draft.passages[work.id] ??= {};
    (draft.passages[work.id] as Record<string, string>)[passage.id] =
      fixed ?? (command.text as string);
    active.position += 1;
    active.watchedMinutes += passage.minutes;
    active.elapsed += passage.minutes;
    draft.settled.push(settlementKey);
    return {
      ok: true,
      notes: [`体验「${passage.label}」：${passage.minutes} 分钟`],
      advanceTo: ctx.now + passage.minutes,
    };
  }

  // action === "scan"
  if (active.mode !== "edit") {
    return fail(
      "扫描三层线索需要先处于编辑分析（edit）模式；请用专业编辑头环或工作站切到 edit 模式",
    );
  }
  if (!check.analysis.includes(command.layer)) {
    return fail(`当前设备不支持${BD_LAYER_LABELS[command.layer]}分析`);
  }
  const seenPassages = new Set(work.passages.slice(0, active.position).map((p) => p.id));
  if (seenPassages.size === 0) {
    return fail("请先至少观看一个片段，再对已看时间轴进行图层扫描");
  }
  const candidates = work.details.filter(
    (d) =>
      d.layer === command.layer &&
      seenPassages.has(d.passage) &&
      (!command.detail || d.id === command.detail),
  );
  if (command.detail && candidates.length === 0) {
    return fail("指定的材料细节不存在、不在已看片段内，或不属于当前扫描图层");
  }
  const newlyFound = candidates.filter(
    (d) => !draft.discoveries.some((found) => found.work === work.id && found.detail === d.id),
  );
  for (const detail of newlyFound) {
    draft.discoveries.push({
      work: work.id,
      detail: detail.id,
      layer: detail.layer,
      finding: detail.finding,
      at: ctx.now,
    });
  }
  const minutes = command.minutes ?? 5;
  active.elapsed += minutes;
  draft.settled.push(settlementKey);
  const notes =
    newlyFound.length > 0
      ? newlyFound.map((d) => `【${BD_LAYER_LABELS[d.layer]}】查出线索：${d.finding}`)
      : [`扫描${BD_LAYER_LABELS[command.layer]}（${minutes} 分钟），已看片段内未发现更多新异常`];
  return { ok: true, notes, advanceTo: ctx.now + minutes };
}
