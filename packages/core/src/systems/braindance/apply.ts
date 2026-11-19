import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { CommerceStateSchema, tradeEvidence } from "../commerce";
import { InventoryStateSchema, itemCatalog } from "../inventory";
import { chipContentCatalog, ShardsStateSchema } from "../shards";
import { merchantSites, type WorldClockState } from "../world";
import {
  type BdExperience,
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

type BdMethod = "observe" | "audio" | "thermal";
export function braindanceSources(
  work: BdWork,
  data: Data,
  slices: Readonly<Record<string, unknown>>,
): readonly { source: BdExperience["source"]; analysis: readonly BdMethod[] }[] {
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
  const result: { source: BdExperience["source"]; analysis: readonly BdMethod[] }[] = [];
  for (const service of Object.values(CommerceStateSchema.parse(slices.commerce).sessions)) {
    const device = merchantSites(data).get(service.seller)?.braindanceDevice;
    if (
      service.service === "bd-session" &&
      service.terms.subject === work.id &&
      service.location === here &&
      ["active", "paused"].includes(service.status) &&
      device?.playback
    )
      result.push({ source: { kind: "service", id: service.id }, analysis: device.analysis });
  }
  for (const carrier of available) {
    const content = carrier.definition?.chipContentId
      ? contents.get(carrier.definition.chipContentId)
      : undefined;
    if (content?.braindance !== work.id) continue;
    for (const device of devices)
      result.push({
        source: { kind: "object", id: carrier.id, device: device.id },
        analysis: device.definition?.braindanceDevice?.analysis ?? [],
      });
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
function sourceBlock(active: BdExperience, work: BdWork, ctx: SystemContext): string | undefined {
  if (ctx.read<WorldClockState>("world").location !== active.location)
    return "先回到当前播放设备和来源所在地点，再继续体验";
  if (
    !sourceOptions(work, ctx).some(
      (option) => JSON.stringify(option.source) === JSON.stringify(active.source),
    )
  )
    return "没有匹配的实际载体和播放设备，或已付款服务不在本地、已经结束、未具备登记设备；按次重看需新的成交服务";
  return undefined;
}

export function applyBraindance(
  draft: Draft<BraindanceState>,
  command: BraindanceCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.settled.includes(command.event)) return { ok: true, notes: ["本次超梦操作已经结算"] };
  if (command.action === "define") {
    if (braindanceWork(draft, ctx.data, command.work.id))
      return fail("作品已确立，不能覆盖原记录；不同剪辑请用清楚区分的新作品身份");
    draft.works[command.work.id] = command.work;
    draft.settled.push(command.event);
    return { ok: true, notes: [`记下作品：${command.work.title}`] };
  }
  if (command.action === "start") {
    if (draft.active) return fail("先退出当前超梦，再开始另一部作品；恢复当前作品用 resume");
    if (draft.history.some((h) => h.id === command.id))
      return fail("体验 id 已使用；重看应建立新一次体验");
    const work = braindanceWork(draft, ctx.data, command.work);
    if (!work) return fail("作品尚未确立，先固定内容与已有材料");
    const previous = command.from ? draft.history.find((h) => h.id === command.from) : undefined;
    if (command.from && (!previous || previous.work !== work.id))
      return fail("续接位置必须来自这部作品已保存的实际体验");
    const active: BdExperience = {
      id: command.id,
      work: work.id,
      source: command.source,
      location: ctx.read<WorldClockState>("world").location,
      startedAt: ctx.now,
      position: previous?.position ?? 0,
      watchedMinutes: previous?.watchedMinutes ?? 0,
      elapsed: 0,
      status: "playing",
    };
    const block = sourceBlock(active, work, ctx);
    if (block) return fail(block);
    draft.works[work.id] = work;
    draft.active = active;
    draft.settled.push(command.event);
    return { ok: true, notes: [`接上超梦：${work.title}；后续通过正文继续、略写看完、暂停或退出`] };
  }
  const active = draft.active;
  if (!active) return fail("当前没有接上的超梦");
  const work = braindanceWork(draft, ctx.data, active.work);
  if (!work) return fail("当前作品资料缺失");
  if (command.action !== "exit" && command.action !== "pause") {
    const block = sourceBlock(active, work, ctx);
    if (block) return fail(block);
  }
  if (active.status === "paused" && !["resume", "exit", "pause"].includes(command.action))
    return fail("当前已暂停；现场交流结束后先恢复播放");
  let minutes = 0;
  let status: "active" | "paused" | "finished" | "exited" = "active";
  const notes: string[] = [];
  switch (command.action) {
    case "progress": {
      const passage = work.passages[active.position];
      if (!passage || passage.id !== command.passage)
        return fail("只可从已保存的位置接着呈现下一片段");
      const fixed = draft.passages[work.id]?.[passage.id];
      if (fixed && command.text && fixed !== command.text)
        return fail("该片段已有定稿，重看不能改写原文");
      if (!fixed && (!command.text || !tradeEvidence(ctx.facts, command.text)))
        return fail("初次片段须保存本轮正文中实际呈现的作品原文");
      draft.passages[work.id] ??= {};
      (draft.passages[work.id] as Record<string, string>)[passage.id] =
        fixed ?? (command.text as string);
      active.position += 1;
      active.watchedMinutes += passage.minutes;
      minutes = passage.minutes;
      notes.push(`体验「${passage.label}」：${minutes} 分钟`);
      break;
    }
    case "finish":
      minutes = work.durationMinutes - active.watchedMinutes;
      active.watchedMinutes = work.durationMinutes;
      active.position = work.passages.length;
      status = "finished";
      notes.push(`略写看完「${work.title}」，实际经过剩余 ${minutes} 分钟`);
      break;
    case "replay": {
      const index = work.passages.findIndex((p) => p.id === command.passage);
      const passage = work.passages[index];
      if (!passage || index >= active.position) return fail("先实际看到该片段，再要求重播");
      minutes = passage.minutes;
      notes.push(`重播「${passage.label}」：${minutes} 分钟；作品进度保持不变`);
      break;
    }
    case "inspect": {
      const detail = work.details.find((d) => d.id === command.detail);
      const input = typeof ctx.facts.braindanceInput === "string" ? ctx.facts.braindanceInput : "";
      const passageIndex = detail ? work.passages.findIndex((p) => p.id === detail.passage) : -1;
      if (
        !detail ||
        passageIndex < 0 ||
        passageIndex >= active.position ||
        !detail.cues.some((cue) => input.includes(cue))
      )
        return fail("只能按本轮实际追问揭示已经看过、确有来源的材料细节");
      const device = sourceOptions(work, ctx).find(
        (option) => JSON.stringify(option.source) === JSON.stringify(active.source),
      );
      if (!device?.analysis.includes(detail.method))
        return fail("原材料与当前设备没有共同支持这项分析，不能凭空生成红外、分离音轨或其他数据");
      minutes = command.minutes;
      if (!draft.discoveries.some((d) => d.work === work.id && d.detail === detail.id))
        draft.discoveries.push({
          work: work.id,
          detail: detail.id,
          finding: detail.finding,
          at: ctx.now,
        });
      notes.push(
        `查证来源「${work.title} / ${work.passages[passageIndex]?.label}」：${detail.finding}`,
      );
      break;
    }
    case "pause":
      active.status = "paused";
      status = "paused";
      notes.push("暂停超梦，现场交流按普通场景记录");
      break;
    case "resume":
      active.status = "playing";
      notes.push("从原位置继续超梦");
      break;
    case "exit":
      status = "exited";
      notes.push(`退出「${work.title}」，保留已观看 ${active.watchedMinutes} 分钟的实际记录`);
      break;
  }
  active.elapsed += minutes;
  const emit: Command[] =
    active.source.kind === "service"
      ? [
          {
            type: "commerce.sessionProgress",
            id: active.source.id,
            elapsed: active.elapsed,
            status,
          },
        ]
      : [];
  if (status === "finished" || status === "exited") {
    draft.history.push({ ...active, outcome: status, at: ctx.now + minutes });
    draft.active = null;
  }
  draft.settled.push(command.event);
  return { ok: true, notes, emit, ...(minutes > 0 ? { advanceTo: ctx.now + minutes } : {}) };
}
