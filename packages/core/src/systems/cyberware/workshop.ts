import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import type { CityState } from "../city";
import { tradeEvidence } from "../commerce";
import { LogisticsStateSchema, routeBlocked } from "../logistics";
import { locationForTravel, merchantAt, type WorldClockState } from "../world";
import { cyberwareCatalog, ripperdocList } from "./apply";
import type { CyberwareState } from "./schema";
import { applyService } from "./service";
import { ensureClinic, visitClinics } from "./stock";
import type { WorkshopCommand } from "./workshop-schema";

export function advanceSupplies(draft: Draft<CyberwareState>, now: number, ctx: SystemContext) {
  const routes = LogisticsStateSchema.parse(ctx.read("logistics"));
  for (const supply of Object.values(draft.supplies)) {
    if (supply.status === "arrived" || supply.status === "cancelled") continue;
    const blocked = routeBlocked(routes, supply.route);
    if (blocked && (supply.status === "blocked" || blocked.at <= supply.due)) {
      if (supply.status !== "blocked")
        supply.remaining = Math.max(1, supply.due - Math.max(supply.checkedAt, blocked.at));
      supply.status = "blocked";
      supply.reason = blocked.reason;
      supply.checkedAt = now;
      continue;
    }
    if (supply.status === "blocked") {
      supply.due = now + supply.remaining;
      supply.status = "pending";
      supply.reason = "路线恢复，继续剩余运输";
    }
    supply.checkedAt = now;
    if (now < supply.due) continue;
    const doc = ripperdocList(ctx.data).find((d) => d.id === supply.doc);
    if (!doc) continue;
    const clinic = ensureClinic(draft, doc, now);
    for (const [model, count] of Object.entries(supply.stock))
      clinic.stock[model] = (clinic.stock[model] ?? 0) + count;
    clinic.revision += 1;
    supply.status = "arrived";
    supply.remaining = 0;
    supply.reason = `供货已由${supply.source}交付`;
  }
}

export function applyWorkshop(
  draft: Draft<CyberwareState>,
  command: WorkshopCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (command.type === "cyberware.service") return applyService(draft, command, ctx);
  const event =
    command.type === "cyberware.clinic" && command.sourceEvent
      ? ctx.read<CityState>("city").events.find((e) => e.id === command.sourceEvent)
      : undefined;
  const evidenceFacts = event ? { tradeNarrative: `${event.title}\n${event.body}` } : ctx.facts;
  if (command.type === "cyberware.clinic" && command.sourceEvent && !event)
    return { ok: false, reason: "诊所经营变化所引用的城市事件不存在" };
  if (!tradeEvidence(evidenceFacts, command.evidence))
    return { ok: false, reason: "义体经营或物件变化缺少真实正文来源" };
  const location = ctx.read<WorldClockState>("world").location;
  if (command.type === "cyberware.clinic") {
    const doc = ripperdocList(ctx.data).find((d) => d.id === command.doc);
    if (!doc) return { ok: false, reason: "诊所不存在" };
    const clinic = ensureClinic(draft, doc, ctx.now);
    if (command.open !== undefined) clinic.open = command.open;
    if (command.staff !== undefined) clinic.staff = command.staff;
    if (command.equipment !== undefined) clinic.equipment = command.equipment;
    clinic.reason = command.reason;
    clinic.revision += 1;
    return { ok: true, notes: ["已按实际事件更新诊所经营条件"] };
  }
  if (command.type === "cyberware.part") {
    const part = draft.parts[command.part];
    const isPlaced = (holder?: string) =>
      holder !== undefined &&
      (holder.startsWith("home:") || holder.startsWith("vehicle:") || holder.startsWith("place:"));
    if (isPlaced(part?.holder) || isPlaced(command.holder))
      return {
        ok: false,
        reason: "留置在别处的义体须使用 itemPlace 留置或取回，同步实际位置与归属",
      };
    if (command.action === "takeStock") {
      const doc = ripperdocList(ctx.data).find((d) => d.id === command.from);
      if (
        part ||
        !doc ||
        !command.model ||
        !command.holder ||
        !merchantAt(ctx.data, doc.id, doc.location, location)
      )
        return { ok: false, reason: "取得库存实物需具体现场诊所、型号、新实物 ID 与持有人" };
      if (
        command.holder === "installed" ||
        command.holder === "scrapped" ||
        command.holder.startsWith("service:")
      )
        return { ok: false, reason: "取得现货不能直接安装或伪造服务" };
      const clinic = ensureClinic(draft, doc, ctx.now);
      if ((clinic.stock[command.model] ?? 0) < 1)
        return { ok: false, reason: "诊所没有这一件实际现货" };
      clinic.stock[command.model] = (clinic.stock[command.model] ?? 0) - 1;
      clinic.revision += 1;
      draft.parts[command.part] = {
        id: command.part,
        model: command.model,
        holder: command.holder,
        location: command.holder === "player" ? null : location,
        condition: command.condition ?? "intact",
        source: command.source,
        at: ctx.now,
      };
      return { ok: true };
    }
    if (command.action === "record") {
      if (
        part ||
        !command.model ||
        !cyberwareCatalog(ctx.data).has(command.model) ||
        !command.holder
      )
        return { ok: false, reason: "新实物需独立身份、已知型号和实际持有人，不能重复生成" };
      if (
        ["installed", "scrapped"].includes(command.holder) ||
        command.holder.startsWith("service:")
      )
        return { ok: false, reason: "不能用实物登记直接安装或伪造手术" };
      draft.parts[command.part] = {
        id: command.part,
        model: command.model,
        holder: command.holder,
        location: command.holder === "player" ? null : (command.location ?? location),
        condition: command.condition ?? "intact",
        source: command.source,
        at: ctx.now,
      };
      return { ok: true };
    }
    if (!part || part.holder === "installed" || part.condition === "scrapped")
      return { ok: false, reason: "这件实物不存在、已安装或已报废" };
    if (
      part.holder.startsWith("service:") &&
      !["cancelled", "interrupted"].includes(draft.services[part.holder.slice(8)]?.status ?? "")
    )
      return { ok: false, reason: "正在服务的实物不能跳过订单直接取走" };
    if (command.action === "condition") {
      if (!command.condition) return { ok: false, reason: "检测须记录实际货况" };
      if (part.condition === "damaged" && command.condition === "intact")
        return { ok: false, reason: "已损坏义体需实际维修，不能用检测抹除损坏" };
      part.condition = command.condition;
      if (command.condition === "scrapped") part.holder = "scrapped";
      return { ok: true };
    }
    if (
      command.from !== part.holder ||
      !command.holder ||
      command.holder === "installed" ||
      command.holder.startsWith("service:")
    )
      return { ok: false, reason: "转交需匹配实际原持有人与有效新持有人" };
    if (part.location !== null && part.location !== location)
      return { ok: false, reason: "实物不在现场，不能隔空转交" };
    part.holder = command.holder;
    part.location = command.holder === "player" ? null : (command.location ?? location);
    part.source = command.source;
    return { ok: true };
  }
  if (command.action === "cancel") {
    const supply = draft.supplies[command.id];
    if (!supply || ["arrived", "cancelled"].includes(supply.status))
      return { ok: false, reason: "供货单不存在或已经结束" };
    supply.status = "cancelled";
    supply.reason = command.source;
    return { ok: true };
  }
  const doc = ripperdocList(ctx.data).find((d) => d.id === command.doc);
  if (
    !doc ||
    draft.supplies[command.id] ||
    !command.stock ||
    !Object.keys(command.stock).length ||
    command.due === undefined ||
    command.due <= ctx.now ||
    !command.route?.length
  )
    return { ok: false, reason: "供货须有新订单、诊所、具体货物、未来到达时刻与实际路线" };
  if (Object.keys(command.stock).some((model) => !cyberwareCatalog(ctx.data).has(model)))
    return { ok: false, reason: "供货包含未知义体型号" };
  if (command.route.some((id) => !locationForTravel(ctx.data, id)))
    return { ok: false, reason: "供货路线包含未知地点" };
  if (!merchantAt(ctx.data, doc.id, doc.location, command.route.at(-1)))
    return { ok: false, reason: "供货路线终点必须是收货诊所的已核对入口" };
  ensureClinic(draft, doc, ctx.now);
  draft.supplies[command.id] = {
    id: command.id,
    doc: doc.id,
    source: command.source,
    stock: command.stock,
    route: command.route,
    due: command.due,
    remaining: command.due - ctx.now,
    checkedAt: ctx.now,
    status: "pending",
    reason: "已确认供货",
  };
  advanceSupplies(draft, ctx.now, ctx);
  return { ok: true };
}

export function tickWorkshop(draft: Draft<CyberwareState>, now: number, ctx: SystemContext) {
  visitClinics(draft, ctx);
  advanceSupplies(draft, now, ctx);
}
