import type { Draft } from "immer";
import type { SystemContext } from "../../kernel/system";
import { merchantAt, type WorldClockState } from "../world";
import { ripperdocList } from "./apply";
import {
  type ClinicState,
  type CyberwareState,
  CyberwareStateSchema,
  type Ripperdoc,
} from "./schema";

export function initialClinic(doc: Ripperdoc, now: number): ClinicState {
  return {
    definition: doc,
    stock: { ...Object.fromEntries(doc.shelf.map((id) => [id, 1])), ...doc.initialStock },
    initializedAt: now,
    revision: 0,
    open: true,
    reason: "初始经营状态",
    staff: [
      ...(doc.keeperNpc ? [doc.keeperNpc] : doc.serviceNpcs.length ? [] : [doc.id]),
      ...doc.serviceNpcs,
    ],
    equipment: [...doc.equipment],
  };
}

export function clinicState(state: CyberwareState, doc: Ripperdoc, now: number): ClinicState {
  return state.clinics[doc.id] ?? initialClinic(doc, now);
}

export function ensureClinic(draft: Draft<CyberwareState>, doc: Ripperdoc, now: number) {
  draft.clinics[doc.id] ??= initialClinic(doc, now);
  return draft.clinics[doc.id] as Draft<ClinicState>;
}

export function visitClinics(draft: Draft<CyberwareState>, ctx: SystemContext) {
  const location = ctx.read<WorldClockState>("world").location;
  for (const doc of ripperdocList(ctx.data)) {
    if (merchantAt(ctx.data, doc.id, doc.location, location)) ensureClinic(draft, doc, ctx.now);
  }
}

/** 未安装实物保留独立身份；同型号批量现货在交付时才分出一件。 */
export function partId(state: CyberwareState, model: string): string {
  let i = 1;
  while (state.parts[`chrome:${model}:${i}`]) i += 1;
  return `chrome:${model}:${i}`;
}

export function actualStock(
  state: CyberwareState,
  doc: Ripperdoc,
  model: string,
  now: number,
  data: Readonly<Record<string, unknown>> = {},
) {
  const loose = Object.values(state.parts).filter(
    (part) =>
      part.model === model &&
      part.holder === doc.id &&
      part.condition === "intact" &&
      (part.location === null || merchantAt(data, doc.id, doc.location, part.location)),
  ).length;
  return (clinicState(state, doc, now).stock[model] ?? 0) + loose;
}

const operationData = new WeakMap<
  CyberwareState,
  WeakMap<object, Readonly<Record<string, unknown>>>
>();

/** 通用诊所服务只读经营事实；避免 inventory 与义体/伤势形成结算依赖环。 */
export function withClinicOperations(
  state: CyberwareState,
  data: Readonly<Record<string, unknown>>,
) {
  let byData = operationData.get(state);
  if (!byData) {
    byData = new WeakMap();
    operationData.set(state, byData);
  }
  const cached = byData.get(data);
  if (cached) return cached;
  const normalized = CyberwareStateSchema.parse(state);
  const definitions = new Map(ripperdocList(data).map((doc) => [doc.id, doc]));
  for (const clinic of Object.values(normalized.clinics))
    definitions.set(clinic.definition.id, clinic.definition);
  const next = {
    ...data,
    ripperdocs: [...definitions.values()],
    clinicOperations: { clinics: normalized.clinics, services: normalized.services },
  };
  byData.set(data, next);
  return next;
}
